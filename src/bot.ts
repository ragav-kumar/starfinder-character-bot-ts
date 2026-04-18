import {
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
  type ClientOptions,
  type Message,
} from "discord.js";

import { logException } from "./logging.js";
import { CharacterBotService } from "./service.js";
import type {
  CommandTarget,
  DashboardAttachment,
  DashboardMessageSnapshot,
  DashboardStore,
  ExistingDashboardAttachment,
  RuntimeConfig,
} from "./types.js";

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("characters")
    .setDescription("Manage tracked Starfinder characters.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add one or more character IDs to tracking.")
        .addStringOption((option) =>
          option.setName("characterids").setDescription("One or more numeric IDs separated by spaces").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove one tracked character ID.")
        .addStringOption((option) => option.setName("characterid").setDescription("The numeric character ID").setRequired(true)),
    )
    .addSubcommand((subcommand) => subcommand.setName("clear").setDescription("Clear all tracked characters."))
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List tracked characters."))
    .addSubcommand((subcommand) => subcommand.setName("refresh").setDescription("Refresh the dashboard now."))
    .addSubcommandGroup((group) =>
      group
        .setName("tracking")
        .setDescription("Manage automatic tracking.")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("start")
            .setDescription("Start automatic tracking.")
            .addIntegerOption((option) =>
              option.setName("pollingperiod").setDescription("Optional polling period in seconds").setRequired(false),
            ),
        )
        .addSubcommand((subcommand) => subcommand.setName("stop").setDescription("Stop automatic tracking.")),
    ),
].map((command) => command.toJSON());

type SendableDashboardChannel = {
  send(payload: {
    content: string;
    files?: AttachmentBuilder[];
    attachments?: Array<{ id: string; filename: string }>;
  }): Promise<Message>;
  messages: {
    fetch(options?: { limit?: number } | string): Promise<Map<string, Message> | Message>;
  };
};

function isTextChannel(channel: unknown): channel is SendableDashboardChannel {
  if (!channel || typeof channel !== "object") {
    return false;
  }

  const maybeChannel = channel as { send?: unknown; messages?: unknown };
  return typeof maybeChannel.send === "function" && typeof maybeChannel.messages === "object";
}

function toExistingAttachment(attachment: Attachment): ExistingDashboardAttachment {
  return {
    kind: "existing",
    id: attachment.id,
    filename: attachment.name,
  };
}

function toDashboardMessageSnapshot(message: Message): DashboardMessageSnapshot {
  return {
    id: message.id,
    channelId: message.channelId,
    content: message.content,
    attachments: [...message.attachments.values()].map(toExistingAttachment),
    createdAt: message.editedAt ?? message.createdAt,
  };
}

function toDiscordFiles(attachments: DashboardAttachment[]): AttachmentBuilder[] {
  return attachments
    .filter((attachment): attachment is Extract<DashboardAttachment, { kind: "rendered" }> => attachment.kind === "rendered")
    .map((attachment) =>
      new AttachmentBuilder(attachment.data, {
        name: attachment.filename,
        description: `Starfinder character ${attachment.characterId}`,
      }),
    );
}

class DiscordDashboardStore implements DashboardStore {
  constructor(private readonly client: Client) {}

  async listChannelMessages(channelId: string): Promise<DashboardMessageSnapshot[]> {
    const channel = await this.requireTextChannel(channelId);
    const messages = await channel.messages.fetch({ limit: 100 });
    if (!(messages instanceof Map)) {
      return [toDashboardMessageSnapshot(messages)];
    }
    return [...messages.values()].map(toDashboardMessageSnapshot);
  }

  async createMessage(
    channelId: string,
    content: string,
    attachments: DashboardAttachment[],
  ): Promise<DashboardMessageSnapshot> {
    const channel = await this.requireTextChannel(channelId);
    const message = await channel.send({
      content,
      files: toDiscordFiles(attachments),
    });
    return toDashboardMessageSnapshot(message);
  }

  async editMessage(
    channelId: string,
    messageId: string,
    content: string,
    attachments: DashboardAttachment[],
  ): Promise<DashboardMessageSnapshot> {
    const channel = await this.requireTextChannel(channelId);
    const fetched = await channel.messages.fetch(messageId);
    if (fetched instanceof Map) {
      throw new Error(`Message ${messageId} could not be fetched.`);
    }
    const message = fetched;
    const edited = await message.edit({
      content,
      files: toDiscordFiles(attachments),
      attachments: attachments
        .filter((attachment): attachment is ExistingDashboardAttachment => attachment.kind === "existing")
        .map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
        })),
    });
    return toDashboardMessageSnapshot(edited);
  }

  private async requireTextChannel(channelId: string): Promise<SendableDashboardChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isTextChannel(channel)) {
      throw new Error(`Channel ${channelId} is not a sendable text channel.`);
    }
    return channel;
  }
}

class DiscordInteractionTarget implements CommandTarget {
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly supportsEphemeral = true;

  constructor(private readonly interaction: ChatInputCommandInteraction) {
    this.guildId = interaction.guildId;
    this.channelId = interaction.channelId;
  }

  async sendAck(
    content: string,
    options: {
      ephemeral?: boolean;
      temporary?: boolean;
    } = {},
  ): Promise<void> {
    const flags = options.ephemeral ? MessageFlags.Ephemeral : undefined;
    if (this.interaction.replied || this.interaction.deferred) {
      await this.interaction.followUp({ content, flags });
    } else {
      await this.interaction.reply({ content, flags });
    }

    if (options.temporary) {
      try {
        if (this.interaction.deferred || this.interaction.replied) {
          await this.interaction.deleteReply();
        }
      } catch (error) {
        logException("DiscordInteractionTarget.sendAck.deleteReply", error, {
          guildId: this.guildId,
          channelId: this.channelId,
        });
        return;
      }
    }
  }
}

export function createDiscordClient(config: RuntimeConfig, service?: CharacterBotService): Client {
  const clientOptions: ClientOptions = {
    intents: [GatewayIntentBits.Guilds],
  };
  const client = new Client(clientOptions);
  const resolvedService = service ?? new CharacterBotService({ config, dashboardStore: new DiscordDashboardStore(client) });

  client.once("ready", async () => {
    if (!client.application) {
      return;
    }
    await client.application.commands.set(commandDefinitions);
    console.log(`Logged in as ${client.user?.tag ?? "unknown"}`);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "characters") {
      return;
    }

    const target = new DiscordInteractionTarget(interaction);

    try {
      const group = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();
      const key = group ? `${group}/${subcommand}` : subcommand;
      switch (key) {
        case "tracking/start":
          await resolvedService.startTracking(target, interaction.options.getInteger("pollingperiod", false) ?? undefined);
          return;
        case "tracking/stop":
          await resolvedService.stopTracking(target);
          return;
        case "add":
          await resolvedService.addCharacters(target, interaction.options.getString("characterids", true));
          return;
        case "remove":
          await resolvedService.removeCharacter(target, interaction.options.getString("characterid", true));
          return;
        case "clear":
          await resolvedService.clearCharacters(target);
          return;
        case "list":
          await resolvedService.listCharacters(target);
          return;
        case "refresh":
          await resolvedService.refreshCharacters(target);
          return;
      }
    } catch (error) {
      logException("createDiscordClient.interactionCreate", error, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        commandName: interaction.commandName,
      });
      const message = `Command failed: ${error instanceof Error ? error.message : String(error)}`;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  });

  return client;
}
