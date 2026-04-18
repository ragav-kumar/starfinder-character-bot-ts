import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ClientOptions,
  type Message,
} from "discord.js";

import { CharacterBotService } from "./service.js";
import type { CommandTarget, PanelMessageHandle, RuntimeConfig, TemporaryMessageHandle } from "./types.js";

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

type SendableChannel = {
  send(content: string): Promise<Message>;
};

function asSendableChannel(channel: unknown): SendableChannel | null {
  if (!channel || typeof channel !== "object") {
    return null;
  }
  const maybeChannel = channel as SendableChannel;
  if (typeof maybeChannel.send !== "function") {
    return null;
  }
  return maybeChannel;
}

class DiscordTemporaryMessage implements TemporaryMessageHandle {
  readonly id: string;
  private readonly message: Message;

  constructor(message: Message) {
    this.id = message.id;
    this.message = message;
  }

  async delete(): Promise<void> {
    await this.message.delete();
  }
}

class DiscordPanelMessage implements PanelMessageHandle {
  readonly id: string;
  readonly channelId: string;
  readonly channel;
  content: string;
  private readonly message: Message;

  constructor(message: Message) {
    this.id = message.id;
    this.channelId = message.channelId;
    this.channel = {
      id: message.channelId,
      send: async (content: string) => {
        const sendableChannel = message.channel as unknown as SendableChannel;
        const sent = await sendableChannel.send(content);
        return new DiscordTemporaryMessage(sent);
      },
    };
    this.content = message.content;
    this.message = message;
  }

  async edit(content: string): Promise<void> {
    const edited = await this.message.edit(content);
    this.content = edited.content;
  }

  async delete(): Promise<void> {
    await this.message.delete();
  }
}

class DiscordInteractionTarget implements CommandTarget {
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly supportsEphemeral = true;

  private readonly interaction: ChatInputCommandInteraction;
  private readonly dashboardChannel: SendableChannel | null;

  constructor(interaction: ChatInputCommandInteraction, dashboardChannel: SendableChannel | null) {
    this.interaction = interaction;
    this.guildId = interaction.guildId;
    this.channelId = interaction.channelId;
    this.dashboardChannel = dashboardChannel;
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
      } catch {
        return;
      }
    }
  }

  async sendPanel(content: string): Promise<PanelMessageHandle> {
    if (!this.dashboardChannel) {
      throw new Error("Dashboard channel is not configured or not sendable.");
    }

    const sent = await this.dashboardChannel.send(content);
    return new DiscordPanelMessage(sent);
  }
}

export function createDiscordClient(config: RuntimeConfig, service = new CharacterBotService({ config })): Client {
  const clientOptions: ClientOptions = {
    intents: [GatewayIntentBits.Guilds],
  };
  const client = new Client(clientOptions);

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

    const guildId = interaction.guildId;
    const dashboardChannelId = guildId ? config.guildChannelConfig[guildId]?.dashboardChannelId : undefined;
    const dashboardChannel = dashboardChannelId
      ? asSendableChannel(await interaction.client.channels.fetch(dashboardChannelId).catch(() => null))
      : null;
    const target = new DiscordInteractionTarget(interaction, dashboardChannel);

    try {
      const group = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();
      const key = group ? `${group}/${subcommand}` : subcommand;
      switch (key) {
        case "tracking/start":
          await service.startTracking(target, interaction.options.getInteger("pollingperiod", false) ?? undefined);
          return;
        case "tracking/stop":
          await service.stopTracking(target);
          return;
        case "add":
          await service.addCharacters(target, interaction.options.getString("characterids", true));
          return;
        case "remove":
          await service.removeCharacter(target, interaction.options.getString("characterid", true));
          return;
        case "clear":
          await service.clearCharacters(target);
          return;
        case "list":
          await service.listCharacters(target);
          return;
        case "refresh":
          await service.refreshCharacters(target);
          return;
      }
    } catch (error) {
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
