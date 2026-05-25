const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  ApplicationCommandOptionType,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const http = require("http");

// ─── CONFIG ────────────────────────────────────────────────────────────[...]
const TOKEN     = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const PORT      = process.env.PORT || 5000;

const TRYOUT_TICKET_CHANNEL  = "1491183434561749123";
const TRYOUT_MANAGER_ROLE    = "1504836079650476065";
const TRYOUT_MANAGER_ROLE_2  = "1491729945062277220";
const GIVEAWAY_HOST_ROLE     = "1503089031649431582";
const TOURNAMENT_HOST_ROLE   = "1503089031649431582";
const TOURNAMENT_CHANNEL     = "1462389214313451561";
const MVCT_SIGNUPS_CHANNEL   = "1507450603540840652";
const LEAGUE_HOST_ROLE       = "1500064722312233050";
const LEAGUE_ROLE            = "1500068561174003853";

const TOURNAMENT_RULES = `**Tournament Disclaimers**

• Any accusations of cheating (dash tech, glitching or exploiting) must be backed up with a clip
• Don't enter with people who can't / don't wish to play with you
• Don't enter if you won't be available for your matches
• This is a flash tournament, you must be ready to complete your match as soon as possible

To enter, please head over to the tournament entries and sign yourself up along with your teammate or yourself!`;

// ─── DATABASE ───────────────────────────────────────────────────────────[...]
const DB_PATH = path.join(__dirname, "database.json");

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { giveaways: {}, tournaments: {}, leagues: {} };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const db = loadDB();

// ─── IN-MEMORY RUNTIME STATE ───────────────────────────────────────────────────
const giveawayTimers  = new Map();
const pendingSignups  = new Map();
const pendingDeclines = new Map();
const spamMap         = new Map();

// ─── HELPERS ───────────────────────────────────────────────────────────[...]
function hasRole(member, ...roleIds) {
  if (!member || !member.roles || !member.roles.cache) return false;
  return roleIds.some((id) => member.roles.cache.has(id));
}

function formatSpotsLeft(current, max) {
  return `${max - current} / ${max}`;
}

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────[...]
const commands = [
  {
    name: "tryout_panel",
    description: "Send the TRYOUT REQUEST panel to the tryout channel",
    default_member_permissions: "8",
  },
  {
    name: "giveaway",
    description: "Manage giveaways",
    options: [
      {
        name: "start",
        description: "Start a new giveaway",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "prize",    description: "The prize",            type: ApplicationCommandOptionType.String,  required: true },
          { name: "duration", description: "Duration in minutes",  type: ApplicationCommandOptionType.Integer, required: true, min_value: 1 },
          { name: "winners",  description: "Number of winners",    type: ApplicationCommandOptionType.Integer, required: false, min_value: 1, max_value: 20 },
        ],
      },
      {
        name: "end",
        description: "End a giveaway early",
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: "message_id", description: "Giveaway message ID", type: ApplicationCommandOptionType.String, required: true }],
      },
      {
        name: "reroll",
        description: "Reroll a giveaway winner",
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: "message_id", description: "Giveaway message ID", type: ApplicationCommandOptionType.String, required: true }],
      },
      {
        name: "cancel",
        description: "Cancel an active giveaway",
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: "message_id", description: "Giveaway message ID", type: ApplicationCommandOptionType.String, required: true }],
      },
    ],
  },
  {
    name: "tournament",
    description: "Manage tournaments",
    options: [
      {
        name: "host",
        description: "Host a tournament",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "prize",       description: "The prize",             type: ApplicationCommandOptionType.String,  required: true },
          {
            name: "type",
            description: "Tournament type",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: "1v1", value: "1v1" },
              { name: "2v2", value: "2v2" },
              { name: "3v3", value: "3v3" },
              { name: "4v4", value: "4v4" },
            ],
          },
          { name: "players",     description: "Max players allowed", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: 100 },
          { name: "server_link", description: "Server invite link",   type: ApplicationCommandOptionType.String,  required: true },
          { name: "banned_map",  description: "Banned map (optional)", type: ApplicationCommandOptionType.String,  required: false },
        ],
      },
      {
        name: "cancel",
        description: "Cancel a tournament",
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: "tournament_id", description: "Tournament ID", type: ApplicationCommandOptionType.String, required: true }],
      },
    ],
  },
  {
    name: "league",
    description: "Manage leagues",
    options: [
      {
        name: "host",
        description: "Host a league",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          {
            name: "format",
            description: "Match format",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [{ name: "2v2", value: "2v2" }, { name: "3v3", value: "3v3" }, { name: "4v4", value: "4v4" }],
          },
          {
            name: "match_type",
            description: "Match type",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [{ name: "Swift Game", value: "Swift Game" }, { name: "War Game", value: "War Game" }],
          },
          {
            name: "perks",
            description: "Perks setting",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [{ name: "Perks", value: "Perks" }, { name: "No Perks", value: "No Perks" }],
          },
          {
            name: "region",
            description: "Region",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
              { name: "Europe",        value: "Europe" },
              { name: "Asia",          value: "Asia" },
              { name: "North America", value: "North America" },
              { name: "South America", value: "South America" },
              { name: "Oceania",       value: "Oceania" },
            ],
          },
        ],
      },
      {
        name: "cancel",
        description: "Cancel a league",
        type: ApplicationCommandOptionType.Subcommand,
        options: [{ name: "league_id", description: "League ID", type: ApplicationCommandOptionType.String, required: true }],
      },
      {
        name: "add",
        description: "Add a player to a league",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "league_id", description: "League ID",       type: ApplicationCommandOptionType.String, required: true },
          { name: "player",    description: "Player to add",   type: ApplicationCommandOptionType.User,   required: true },
        ],
      },
      {
        name: "remove",
        description: "Remove a player from a league",
        type: ApplicationCommandOptionType.Subcommand,
        options: [
          { name: "league_id", description: "League ID",          type: ApplicationCommandOptionType.String, required: true },
          { name: "player",    description: "Player to remove",   type: ApplicationCommandOptionType.User,   required: true },
        ],
      },
    ],
  },
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("Slash commands registered globally.");
}

// ─── CLIENT ────────────────────────────────────────────────────────────[...]
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ─── READY ────────────────────────────────────────────────────────────[...]
client.once("ready", async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

// ─── INTERACTION ROUTER ──────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand())  await handleCommand(interaction);
    else if (interaction.isButton())       await handleButton(interaction);
    else if (interaction.isModalSubmit())  await handleModal(interaction);
  } catch (err) {
    console.error("Interaction error:", err);
    if (interaction.replied || interaction.deferred) return;
    try { await interaction.reply({ content: "Something went wrong.", flags: 64 }); } catch {}
  }
});

// ─── SPAM PROTECTION ─────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.member) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const data = spamMap.get(key) || { count: 0, lastMessage: now, warned: false, muted: false };

  if (now - data.lastMessage > 4000) {
    data.count = 1;
    data.warned = false;
  } else {
    data.count++;
  }
  data.lastMessage = now;
  spamMap.set(key, data);

  if (data.muted) return;

  if (data.count >= 5) {
    data.muted = true;
    try {
      await message.channel.send(`<@${message.author.id}> has been muted for **5 minutes** for spamming.`);
      await message.member.timeout(5 * 60 * 1000, "Spam protection");
      setTimeout(() => {
        const d = spamMap.get(key);
        if (d) { d.muted = false; d.count = 0; d.warned = false; }
      }, 5 * 60 * 1000);
    } catch {}
    return;
  }

  if (data.count >= 4 && !data.warned) {
    data.warned = true;
    try {
      const warn = await message.channel.send(
        `<@${message.author.id}>, slow down! Continuing to spam will result in a mute.`
      );
      setTimeout(() => warn.delete().catch(() => {}), 5000);
    } catch {}
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  COMMAND HANDLER
// ═════════════════════════════════════════════════════════════════════════════
async function handleCommand(interaction) {
  const cmd = interaction.commandName;

  // ── TRYOUT PANEL ──────────────────────────────────────────────────────────
  if (cmd === "tryout_panel") {
    // Allow admins and tryout managers to send the panel
    const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
    const isManager = hasRole(interaction.member, TRYOUT_MANAGER_ROLE, TRYOUT_MANAGER_ROLE_2);
    if (!isAdmin && !isManager)
      return interaction.reply({ content: "Only Tryout Managers or Admins can send the tryout panel.", flags: 64 });

    await interaction.deferReply({ flags: 64 });

    const channel = await client.channels.fetch(TRYOUT_TICKET_CHANNEL).catch(() => null);
    if (!channel) return interaction.editReply({ content: `❌ Could not find the tryout channel (<#${TRYOUT_TICKET_CHANNEL}>). Make sure the bot has access to it.` });

    const embed = new EmbedBuilder()
      .setTitle("📅 SCHEDULE TRYOUT")
      .setDescription("Want to try out for the team? Click the button below to schedule your tryout session with our staff.")
      .setColor(0x5865f2)
      .setFooter({ text: "Your application will be reviewed by our staff team" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("tryout_open_ticket")
        .setLabel("SCHEDULE TRYOUT")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📅")
    );

    try {
      await channel.send({ embeds: [embed], components: [row] });
      return interaction.editReply({ content: `✅ Tryout panel sent to <#${TRYOUT_TICKET_CHANNEL}>!` });
    } catch (err) {
      console.error("Failed to send tryout panel:", err);
      return interaction.editReply({ content: `❌ Failed to send the panel: ${err.message}` });
    }
  }


  // ── GIVEAWAY ──────────────────────────────────────────────────────────────
  if (cmd === "giveaway") {
    if (!hasRole(interaction.member, GIVEAWAY_HOST_ROLE))
      return interaction.reply({ content: "Only Giveaway Hosts can manage giveaways.", flags: 64 });

    const sub = interaction.options.getSubcommand();

    if (sub === "start") {
      const prize    = interaction.options.getString("prize");
      const duration = interaction.options.getInteger("duration");
      const winners  = interaction.options.getInteger("winners") ?? 1;
      const endsAt   = Date.now() + duration * 60 * 1000;

      const embed = buildGiveawayEmbed(prize, winners, endsAt, interaction.user.id, []);
      const row = giveawayEntryRow(false);

      await interaction.reply({ content: "Giveaway started!", flags: 64 });
      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

      db.giveaways[msg.id] = {
        messageId: msg.id, channelId: interaction.channelId,
        prize, winners, hostId: interaction.user.id,
        endsAt, ended: false, participants: [], winnerIds: [],
      };
      saveDB(db);

      const timer = setTimeout(() => endGiveaway(msg.id), duration * 60 * 1000);
      giveawayTimers.set(msg.id, timer);
      return;
    }

    if (sub === "end") {
      const msgId = interaction.options.getString("message_id");
      await endGiveaway(msgId);
      return interaction.reply({ content: "Giveaway ended.", flags: 64 });
    }

    if (sub === "reroll") {
      const msgId = interaction.options.getString("message_id");
      const data  = db.giveaways[msgId];
      if (!data || !data.ended)
        return interaction.reply({ content: "Could not find an ended giveaway with that ID.", flags: 64 });

      const eligible = data.participants.filter((id) => id !== data.hostId && !data.winnerIds.includes(id));
      if (!eligible.length)
        return interaction.reply({ content: "No more eligible participants to reroll.", flags: 64 });

      const winner = eligible[Math.floor(Math.random() * eligible.length)];
      data.winnerIds.push(winner);
      saveDB(db);

      await interaction.reply(
        `Reroll! The new winner is <@${winner}>! Congratulations! Contact <@${data.hostId}> to claim **${data.prize}**.`
      );

      try {
        const ch  = await client.channels.fetch(data.channelId);
        const msg = await ch.messages.fetch(msgId);
        const mentions = data.winnerIds.map((id) => `<@${id}>`).join(", ");
        await msg.edit({
          embeds: [new EmbedBuilder()
            .setTitle("Giveaway Ended! (Rerolled)")
            .setDescription(`**Prize:** ${data.prize}\n**Winners:** ${mentions}\n**Hosted by:** <@${data.hostId}>`)
            .setColor(0xffd700)
            .setFooter({ text: `${data.participants.length} participants` })
            .setTimestamp()],
        });
      } catch {}
      return;
    }

    if (sub === "cancel") {
      const msgId = interaction.options.getString("message_id");
      const data  = db.giveaways[msgId];
      if (!data) return interaction.reply({ content: "Giveaway not found.", flags: 64 });

      const timer = giveawayTimers.get(msgId);
      if (timer) { clearTimeout(timer); giveawayTimers.delete(msgId); }
      data.ended = true;
      saveDB(db);

      try {
        const ch  = await client.channels.fetch(data.channelId);
        const msg = await ch.messages.fetch(msgId);
        await msg.edit({
          embeds: [new EmbedBuilder()
            .setTitle("Giveaway Cancelled")
            .setDescription(`**Prize:** ${data.prize}\n\nCancelled by <@${interaction.user.id}>.`)
            .setColor(0xff0000).setTimestamp()],
          components: [giveawayEntryRow(true)],
        });
      } catch {}

      delete db.giveaways[msgId];
      saveDB(db);
      return interaction.reply({ content: "Giveaway cancelled.", flags: 64 });
    }
  }

  // ── TOURNAMENT ────────────────────────────────────────────────────────────
  if (cmd === "tournament") {
    if (!hasRole(interaction.member, TOURNAMENT_HOST_ROLE))
      return interaction.reply({ content: "Only Tournament Hosts can manage tournaments.", flags: 64 });

    const sub = interaction.options.getSubcommand();

    if (sub === "host") {
      if (interaction.channelId !== TOURNAMENT_CHANNEL)
        return interaction.reply({ content: `Tournaments can only be hosted in <#${TOURNAMENT_CHANNEL}>.`, flags: 64 });

      const prize      = interaction.options.getString("prize");
      const type       = interaction.options.getString("type");
      const maxPlayers = interaction.options.getInteger("players");
      const serverLink = interaction.options.getString("server_link");
      const bannedMap  = interaction.options.getString("banned_map") ?? "None";
      const id = "MVCT-" + Date.now().toString(36).toUpperCase();

      const embed = buildTournamentEmbed(id, prize, type, bannedMap, serverLink, interaction.user.id, 0, maxPlayers);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`t_signup_${id}`).setLabel("Sign Up").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`t_rules_${id}`).setLabel("Rules").setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({ content: "Tournament hosted!", flags: 64 });
      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

      db.tournaments[id] = {
        id, prize, type, bannedMap, serverLink,
        hostId: interaction.user.id, channelId: interaction.channelId,
        signupMessageId: msg.id, maxPlayers, signups: [], active: true,
      };
      saveDB(db);

      const signupsCh = await client.channels.fetch(MVCT_SIGNUPS_CHANNEL).catch(() => null);
      if (signupsCh) {
        await signupsCh.send({
          content: "@everyone",
          embeds: [new EmbedBuilder()
            .setTitle(`Tournament Open — ${id}`)
            .setDescription(`**Prize:** ${prize}\n**Type:** ${type}\n**Banned Map:** ${bannedMap}\n\nPlayers Joined: **0 / ${maxPlayers}**`)
            .setColor(0x57f287).setTimestamp()],
        });
      }
      return;
    }

    if (sub === "cancel") {
      const id   = interaction.options.getString("tournament_id").toUpperCase();
      const data = db.tournaments[id];
      if (!data) return interaction.reply({ content: `Tournament \`${id}\` not found.`, flags: 64 });

      data.active = false;
      try {
        const ch  = await client.channels.fetch(data.channelId);
        const msg = await ch.messages.fetch(data.signupMessageId);
        await msg.edit({
          embeds: [new EmbedBuilder()
            .setTitle("Tournament Cancelled")
            .setDescription(`**${id}** cancelled by <@${interaction.user.id}>.`)
            .setColor(0xff0000).setTimestamp()],
          components: [],
        });
      } catch {}

      delete db.tournaments[id];
      saveDB(db);
      return interaction.reply({ content: `Tournament \`${id}\` cancelled.` });
    }
  }

  // ── LEAGUE ────────────────────────────────────────────────────────────────
  if (cmd === "league") {
    if (!hasRole(interaction.member, LEAGUE_HOST_ROLE))
      return interaction.reply({ content: "Only League Hosts can manage leagues.", flags: 64 });

    const sub = interaction.options.getSubcommand();

    if (sub === "host") {
      const format     = interaction.options.getString("format");
      const matchType  = interaction.options.getString("match_type");
      const perks      = interaction.options.getString("perks");
      const region     = interaction.options.getString("region");
      const maxPlayers = parseInt(format.split("v")[0]) * 2;
      const id = randomLeagueId();

      const embed = buildLeagueEmbed(id, format, matchType, perks, region, interaction.user.id, maxPlayers, [interaction.user.id]);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`league_join_${id}`).setLabel("Join League").setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({ content: "League hosted!", flags: 64 });
      const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

      db.leagues[id] = {
        id, format, matchType, perks, region,
        hostId: interaction.user.id, channelId: interaction.channelId,
        messageId: msg.id, maxPlayers, players: [interaction.user.id],
        threadId: null, active: true,
      };
      saveDB(db);

      // Create private thread (fall back to public if boost level too low)
      try {
        let thread;
        try {
          thread = await msg.channel.threads.create({
            name: `League ${id}`,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: `Private thread for league ${id}`,
          });
        } catch (privateErr) {
          console.warn(`[League ${id}] Private thread failed, falling back to public thread:`, privateErr?.message ?? privateErr);
          thread = await msg.channel.threads.create({
            name: `League ${id}`,
            type: ChannelType.PublicThread,
            reason: `Thread for league ${id}`,
          });
        }

        db.leagues[id].threadId = thread.id;
        saveDB(db);

        // Add host to thread with explicit send permissions
        try {
          await thread.members.add(interaction.user.id);
          await thread.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });
        } catch (err) {
          console.error(`Failed to set host permissions for league ${id}:`, err);
        }

        await thread.send(`<@${interaction.user.id}> League **${id}** has been created! Players will be added as they join.`);

        // Ping the league role in the parent channel
        await msg.channel.send(`<@&${LEAGUE_ROLE}> New league available: **${id}**`);
      } catch (err) {
        console.error(`Failed to create league thread for ${id}:`, err);
      }

      return;
    }

    if (sub === "cancel") {
      const id   = interaction.options.getString("league_id").toUpperCase();
      const data = db.leagues[id];
      if (!data) return interaction.reply({ content: `League \`${id}\` not found.`, flags: 64 });

      try {
        const ch  = await client.channels.fetch(data.channelId);
        const msg = await ch.messages.fetch(data.messageId);
        await msg.edit({
          embeds: [new EmbedBuilder()
            .setTitle("League Cancelled")
            .setDescription(`League **${id}** cancelled by <@${interaction.user.id}>.`)
            .setColor(0xff0000).setTimestamp()],
          components: [],
        });
      } catch {}

      if (data.threadId) {
        try {
          const thread = await client.channels.fetch(data.threadId);
          await thread.delete("League cancelled");
        } catch {}
      }

      delete db.leagues[id];
      saveDB(db);
      return interaction.reply({ content: `League \`${id}\` cancelled.` });
    }

    if (sub === "add") {
      const id     = interaction.options.getString("league_id").toUpperCase();
      const target = interaction.options.getUser("player");
      const data   = db.leagues[id];
      if (!data)                            return interaction.reply({ content: `League \`${id}\` not found.`, flags: 64 });
      if (data.players.includes(target.id)) return interaction.reply({ content: `<@${target.id}> is already in this league.`, flags: 64 });
      if (data.players.length >= data.maxPlayers) return interaction.reply({ content: "League is full.", flags: 64 });

      data.players.push(target.id);
      saveDB(db);

      if (data.threadId) {
        try {
          const thread = await client.channels.fetch(data.threadId);
          await thread.members.add(target.id);
          await thread.permissionOverwrites.edit(target.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });
          await thread.send(`<@${target.id}> was added by <@${interaction.user.id}>.`);
        } catch (err) {
          console.error(`Failed to add player to thread:`, err);
        }
      }

      await updateLeagueMessage(data);
      await interaction.reply({ content: `Added <@${target.id}> to league \`${id}\`.` });

      if (data.players.length >= data.maxPlayers) await autoTeamUp(data, interaction.guild);
      return;
    }

    if (sub === "remove") {
      const id     = interaction.options.getString("league_id").toUpperCase();
      const target = interaction.options.getUser("player");
      const data   = db.leagues[id];
      if (!data)                             return interaction.reply({ content: `League \`${id}\` not found.`, flags: 64 });
      if (!data.players.includes(target.id)) return interaction.reply({ content: `<@${target.id}> is not in this league.`, flags: 64 });

      data.players = data.players.filter((pid) => pid !== target.id);
      saveDB(db);

      if (data.threadId) {
        try {
          const thread = await client.channels.fetch(data.threadId);
          await thread.members.remove(target.id);
          await thread.send(`<@${target.id}> was removed by <@${interaction.user.id}>.`);
        } catch (err) {
          console.error(`Failed to remove player from thread:`, err);
        }
      }

      await updateLeagueMessage(data);
      await interaction.reply({ content: `Removed <@${target.id}> from league \`${id}\`.` });

      // Re-auto team if league is still full and active
      if (data.players.length >= data.maxPlayers && data.active) {
        await autoTeamUp(data, interaction.guild);
      }
      return;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUTTON HANDLER
// ═════════════════════════════════════════════════════════════════════════════
async function handleButton(interaction) {
  const id = interaction.customId;

  // ── TRYOUT: Open Ticket ───────────────────────────────────────────────────
  if (id === "tryout_open_ticket") {
    const modal = new ModalBuilder().setCustomId("tryout_modal").setTitle("Schedule Tryout");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("tryout_roblox").setLabel("Roblox username").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("enter your username")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("tryout_platform").setLabel("Platform").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("PC/MOB/XBOX")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("tryout_server").setLabel("Private server link").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("paste server link here")
      ),
    );
    return interaction.showModal(modal);
  }

  // ── TRYOUT: Close Ticket ──────────────────────────────────────────────────
  if (id.startsWith("tryout_close_")) {
    if (!hasRole(interaction.member, TRYOUT_MANAGER_ROLE, TRYOUT_MANAGER_ROLE_2))
      return interaction.reply({ content: "Only Tryout Managers can close tickets.", flags: 64 });

    await interaction.reply({ content: "Closing ticket in 5 seconds..." });
    setTimeout(async () => {
      try { await interaction.channel.delete("Tryout ticket closed"); } catch {}
    }, 5000);
    return;
  }

  // ── GIVEAWAY: Enter ──────────────────────────────────────────────────────
  if (id === "giveaway_enter") {
    const data = db.giveaways[interaction.message.id];
    if (!data || data.ended) return interaction.reply({ content: "This giveaway has already ended.", flags: 64 });

    const userId = interaction.user.id;
    if (data.participants.includes(userId)) {
      data.participants = data.participants.filter((i) => i !== userId);
      await interaction.reply({ content: "You left the giveaway.", flags: 64 });
    } else {
      data.participants.push(userId);
      await interaction.reply({ content: "You entered the giveaway! Good luck!", flags: 64 });
    }
    saveDB(db);

    await interaction.message.edit({
      embeds: [buildGiveawayEmbed(data.prize, data.winners, data.endsAt, data.hostId, data.participants)],
    });
    return;
  }

  // ── TOURNAMENT: Rules ──────────────────────────────────────────────────────
  if (id.startsWith("t_rules_")) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle("Tournament Rules").setDescription(TOURNAMENT_RULES).setColor(0xfee75c)],
      flags: 64,
    });
  }

  // ── TOURNAMENT: Sign Up ────────────────────────────────────────────────────
  if (id.startsWith("t_signup_")) {
    const tid  = id.replace("t_signup_", "");
    const data = db.tournaments[tid];
    if (!data || !data.active) return interaction.reply({ content: "This tournament is no longer active.", flags: 64 });

    const already = data.signups.some((s) => s.discordId === interaction.user.id);
    if (already) return interaction.reply({ content: "You already signed up for this tournament.", flags: 64 });

    const accepted = data.signups.filter((s) => s.status === "accepted").length;
    if (accepted >= data.maxPlayers) return interaction.reply({ content: "This tournament is full.", flags: 64 });

    const modal = new ModalBuilder().setCustomId(`t_modal_${tid}`).setTitle("Tournament Sign Up");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("t_roblox").setLabel("Roblox Username").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("t_rank").setLabel("Your Rank / Division").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("e.g. Gold III")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("t_discord").setLabel("Discord Username").setStyle(TextInputStyle.Short).setRequired(true)
      ),
    );
    return interaction.showModal(modal);
  }

  // ── TOURNAMENT: Accept ───────────────────────────────────────────────────
  if (id.startsWith("tsignup_accept_")) {
    const key      = id.replace("tsignup_accept_", "");
    const pending  = pendingSignups.get(key);
    if (!pending) return interaction.reply({ content: "This signup has expired.", flags: 64 });

    const { tid, entry } = pending;
    const data = db.tournaments[tid];
    pendingSignups.delete(key);

    if (!data) return interaction.reply({ content: "Tournament no longer exists.", flags: 64 });

    entry.status = "accepted";
    data.signups.push(entry);
    saveDB(db);

    const acceptedCount = data.signups.filter((s) => s.status === "accepted").length;

    await interaction.reply({ content: `✅ Accepted **${entry.robloxUsername}** — ${acceptedCount}/${data.maxPlayers} players.`, flags: 64 });

    // Update signups channel
    try {
      const signupsCh = await client.channels.fetch(MVCT_SIGNUPS_CHANNEL).catch(() => null);
      if (signupsCh) {
        await signupsCh.send({
          embeds: [new EmbedBuilder()
            .setTitle(tid)
            .addFields(
              { name: "Discord user", value: `<@${entry.discordId}>`, inline: false },
              { name: "Roblox user", value: entry.robloxUsername, inline: false },
              { name: "Rank", value: entry.rank, inline: false },
              { name: "Status", value: "✅ **ACCEPTED**", inline: false }
            )
            .setColor(0x57f287)
            .setTimestamp()],
        });
      }
    } catch (err) {
      console.error("Failed to update signups channel:", err);
    }

    // Update tournament embed
    try {
      const ch  = await client.channels.fetch(data.channelId);
      const msg = await ch.messages.fetch(data.signupMessageId);
      const updEmbed = buildTournamentEmbed(data.id, data.prize, data.type, data.bannedMap, data.serverLink, data.hostId, acceptedCount, data.maxPlayers);
      let components = msg.components;
      if (acceptedCount >= data.maxPlayers) {
        data.active = false;
        saveDB(db);
        components = [];
        await ch.send(`Tournament **${tid}** is **FULL!** All ${data.maxPlayers} slots are filled.`);
      }
      await msg.edit({ embeds: [updEmbed], components });
    } catch (err) {
      console.error("Failed to update tournament embed:", err);
    }

    // DM accepted player
    try {
      const user = await client.users.fetch(entry.discordId);
      await user.send(
        `✅ You've been **accepted** into tournament **${tid}**!\n\n**Prize:** ${data.prize}\n**Type:** ${data.type}\n**Server:** ${data.serverLink}\n\nGood luck!`
      ).catch(() => {});
    } catch {}

    try { await interaction.message.edit({ components: [] }); } catch {}
    return;
  }

  // ── TOURNAMENT: Decline (Show Modal) ──────────────────────────────────────
  if (id.startsWith("tsignup_decline_")) {
    const key = id.replace("tsignup_decline_", "");
    const pending = pendingSignups.get(key);
    if (!pending) return interaction.reply({ content: "This signup has expired.", flags: 64 });

    // Store the key temporarily for the modal handler
    pendingDeclines.set(key, pending);

    const modal = new ModalBuilder().setCustomId(`t_decline_modal_${key}`).setTitle("Decline Reason");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("decline_reason")
          .setLabel("Reason for decline")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("Enter reason for declining this player")
      )
    );
    return interaction.showModal(modal);
  }

  // ── LEAGUE: Join ───────────────────────────────────────────────────────────
  if (id.startsWith("league_join_")) {
    const lid  = id.replace("league_join_", "");
    const data = db.leagues[lid];
    if (!data || !data.active) return interaction.reply({ content: "This league is no longer active.", flags: 64 });
    if (data.players.includes(interaction.user.id)) return interaction.reply({ content: "You are already in this league.", flags: 64 });
    if (data.players.length >= data.maxPlayers) return interaction.reply({ content: "This league is full.", flags: 64 });

    data.players.push(interaction.user.id);
    saveDB(db);

    await interaction.reply({ content: `You joined league **${lid}**! (${data.players.length}/${data.maxPlayers})`, flags: 64 });

    if (data.threadId) {
      try {
        const thread = await client.channels.fetch(data.threadId);
        await thread.members.add(interaction.user.id);
        await thread.permissionOverwrites.edit(interaction.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
        await thread.send(`<@${interaction.user.id}> joined the league!`);
      } catch (err) {
        console.error(`Failed to add player to thread:`, err);
      }
    }

    await updateLeagueMessage(data);

    if (data.players.length >= data.maxPlayers && data.active) {
      await autoTeamUp(data, interaction.guild);
    }
    return;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MODAL HANDLER
// ═════════════════════════════════════════════════════════════════════════════
async function handleModal(interaction) {
  const id = interaction.customId;

  // ── TRYOUT MODAL ───────────────────────────────────────────────────────────
  if (id === "tryout_modal") {
    const roblox   = interaction.fields.getTextInputValue("tryout_roblox");
    const platform = interaction.fields.getTextInputValue("tryout_platform");
    const server   = interaction.fields.getTextInputValue("tryout_server");
    const userId   = interaction.user.id;
    const username = interaction.user.username;
    const guild    = interaction.guild;

    await interaction.deferReply({ flags: 64 });

    const ticketName = `tryout-${username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}-${Date.now().toString(36)}`;

    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: null,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: TRYOUT_MANAGER_ROLE,   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
          { id: TRYOUT_MANAGER_ROLE_2, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
        ],
      });
    } catch (err) {
      console.error("Failed to create ticket channel:", err);
      return interaction.editReply({ content: "❌ Failed to create ticket channel. Please contact a staff member." });
    }

    const embed = new EmbedBuilder()
      .setTitle("Tryout Request")
      .setColor(0x5865f2)
      .addFields(
        { name: "Discord User",        value: `<@${userId}>`, inline: true },
        { name: "Roblox Username",     value: `**${roblox}**`,         inline: true },
        { name: "Platform",            value: `**${platform}**`,       inline: true },
        { name: "Private Server Link", value: `[Server](${server})`, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: `Ticket by ${username}` });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tryout_close_${ticketChannel.id}`).setLabel("Close Ticket").setStyle(ButtonStyle.Danger).setEmoji("🔒")
    );

    await ticketChannel.send({
      content: `<@${userId}>`,
      embeds: [embed],
      components: [closeRow],
    });

    // Send notification to managers in a separate message
    await ticketChannel.send(`<@&${TRYOUT_MANAGER_ROLE}> <@&${TRYOUT_MANAGER_ROLE_2}> New tryout request from <@${userId}>!`);

    return interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
  }

  // ── TOURNAMENT SIGNUP MODAL ────────────────────────────────────────────────
  if (id.startsWith("t_modal_")) {
    const tid  = id.replace("t_modal_", "");
    const data = db.tournaments[tid];
    if (!data || !data.active) return interaction.reply({ content: "Tournament no longer active.", flags: 64 });

    const roblox  = interaction.fields.getTextInputValue("t_roblox");
    const rank    = interaction.fields.getTextInputValue("t_rank");
    const discord = interaction.fields.getTextInputValue("t_discord");

    const entry = { discordId: interaction.user.id, robloxUsername: roblox, rank, discordUsername: discord, status: "pending" };
    const key   = `${tid}_${interaction.user.id}_${Date.now()}`;
    pendingSignups.set(key, { tid, entry });

    const formEmbed = new EmbedBuilder()
      .setTitle("New Tournament Signup")
      .setColor(0x5865f2)
      .addFields(
        { name: "Tournament",      value: tid,                            inline: true },
        { name: "Roblox Username", value: roblox,                        inline: true },
        { name: "Rank",            value: rank,                          inline: true },
        { name: "Discord",         value: discord,                       inline: true },
        { name: "Mention",         value: `<@${interaction.user.id}>`,   inline: true },
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tsignup_accept_${key}`).setLabel("Accept").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tsignup_decline_${key}`).setLabel("Decline").setStyle(ButtonStyle.Danger),
    );

    try {
      const host = await client.users.fetch(data.hostId);
      await host.send({ embeds: [formEmbed], components: [row] });
      return interaction.reply({ content: "✅ Signup submitted! The host will review it shortly.", flags: 64 });
    } catch {
      return interaction.reply({ content: "✅ Signup submitted but couldn't DM the host (DMs may be closed).", flags: 64 });
    }
  }

  // ── TOURNAMENT DECLINE REASON MODAL ──────────────────────────────────────
  if (id.startsWith("t_decline_modal_")) {
    const key = id.replace("t_decline_modal_", "");
    const pending = pendingDeclines.get(key);
    if (!pending) return interaction.reply({ content: "This decline has expired.", flags: 64 });

    const reason = interaction.fields.getTextInputValue("decline_reason");
    const { tid, entry } = pending;
    const data = db.tournaments[tid];
    
    pendingDeclines.delete(key);
    pendingSignups.delete(key);

    if (!data) return interaction.reply({ content: "Tournament no longer exists.", flags: 64 });

    entry.status = "declined";
    entry.declineReason = reason;
    data.signups.push(entry);
    saveDB(db);

    await interaction.reply({ content: `❌ Declined **${entry.robloxUsername}** - Reason: ${reason}`, flags: 64 });

    // Update signups channel
    try {
      const signupsCh = await client.channels.fetch(MVCT_SIGNUPS_CHANNEL).catch(() => null);
      if (signupsCh) {
        await signupsCh.send({
          embeds: [new EmbedBuilder()
            .setTitle(tid)
            .addFields(
              { name: "Discord user", value: `<@${entry.discordId}>`, inline: false },
              { name: "Roblox user", value: entry.robloxUsername, inline: false },
              { name: "Rank", value: entry.rank, inline: false },
              { name: "Status", value: "❌ **DECLINED**", inline: false },
              { name: "Reason", value: reason, inline: false }
            )
            .setColor(0xff0000)
            .setTimestamp()],
        });
      }
    } catch (err) {
      console.error("Failed to update signups channel:", err);
    }

    // DM declined player
    try {
      const user = await client.users.fetch(entry.discordId);
      await user.send(`❌ Your signup for tournament **${tid}** was **declined**.\n\n**Reason:** ${reason}`).catch(() => {});
    } catch {}

    try { await interaction.message.edit({ components: [] }); } catch {}
    return;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  GIVEAWAY HELPERS
// ═════════════════════════════════════════════════════════════════════════════
async function endGiveaway(messageId) {
  const data = db.giveaways[messageId];
  if (!data || data.ended) return;

  data.ended = true;
  const timer = giveawayTimers.get(messageId);
  if (timer) { clearTimeout(timer); giveawayTimers.delete(messageId); }
  saveDB(db);

  const channel = await client.channels.fetch(data.channelId).catch(() => null);
  if (!channel) return;

  let msg;
  try { msg = await channel.messages.fetch(messageId); } catch { return; }

  const eligible = data.participants.filter((id) => id !== data.hostId);
  const picked   = [];

  if (eligible.length === 0) {
    await msg.edit({
      embeds: [new EmbedBuilder()
        .setTitle("Giveaway Ended")
        .setDescription(`**Prize:** ${data.prize}\n\nNo eligible participants — no winner this time.`)
        .setColor(0xff0000).setTimestamp()],
      components: [giveawayEntryRow(true)],
    });
    await channel.send(`Giveaway Ended! No valid participants entered for **${data.prize}**.`);
    return;
  }

  const pool = [...eligible];
  for (let i = 0; i < data.winners && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }

  data.winnerIds = picked;
  saveDB(db);

  const mentions = picked.map((id) => `<@${id}>`).join(", ");

  await msg.edit({
    embeds: [new EmbedBuilder()
      .setTitle("Giveaway Ended")
      .setColor(0x5865f2)
      .addFields(
        { name: "Prize",         value: data.prize,                       inline: false },
        { name: "Winners",       value: mentions,                         inline: false },
        { name: "Total Entries", value: String(data.participants.length), inline: true  },
        { name: "Hosted By",     value: `<@${data.hostId}>`,              inline: true  },
      )
      .setTimestamp()],
    components: [giveawayEntryRow(true)],
  });

  await channel.send(
    `Congratulations ${mentions}! You have won the **${data.prize}** giveaway.`
  );
}

function buildGiveawayEmbed(prize, winners, endsAt, hostId, participants) {
  return new EmbedBuilder()
    .setTitle("GIVEAWAY")
    .setDescription(
      `**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n**Hosted by:** <@${hostId}>\n\nClick the button below to enter!`
    )
    .setColor(0x5865f2)
    .setFooter({ text: `${participants.length} participant${participants.length !== 1 ? "s" : ""}` })
    .setTimestamp(endsAt);
}

function giveawayEntryRow(disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("giveaway_enter")
      .setLabel(disabled ? "Giveaway Ended" : "Enter Giveaway")
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOURNAMENT HELPERS
// ═════════════════════════════════════════════════════════════════════════════
function buildTournamentEmbed(id, prize, type, bannedMap, serverLink, hostId, current, max) {
  return new EmbedBuilder()
    .setTitle("Tournament Hosted!")
    .setColor(0xfee75c)
    .addFields(
      { name: "Prize",         value: prize,                 inline: true },
      { name: "Type",          value: type,                  inline: true },
      { name: "Banned Map",    value: bannedMap,             inline: true },
      { name: "Host",          value: `<@${hostId}>`,        inline: true },
      { name: "Players",       value: `${current} / ${max}`, inline: true },
      { name: "Server Link",   value: serverLink,            inline: true },
      { name: "Tournament ID", value: `\`${id}\``,           inline: true },
      { name: "Rules",         value: TOURNAMENT_RULES },
    )
    .setTimestamp()
    .setFooter({ text: `Cancel: /tournament cancel ${id}` });
}

// ═════════════════════════════════════════════════════════════════════════════
//  LEAGUE HELPERS
// ═════════════════════════════════════════════════════════════════════════════
async function updateLeagueMessage(data) {
  try {
    const ch    = await client.channels.fetch(data.channelId);
    const msg   = await ch.messages.fetch(data.messageId);
    const embed = buildLeagueEmbed(data.id, data.format, data.matchType, data.perks, data.region, data.hostId, data.maxPlayers, data.players);
    const components = data.players.length >= data.maxPlayers ? [] : msg.components;
    await msg.edit({ embeds: [embed], components });
  } catch (err) {
    console.error("Failed to update league message:", err);
  }
}

async function autoTeamUp(data, guild) {
  data.active = false;
  saveDB(db);

  const half     = Math.floor(data.players.length / 2);
  const shuffled = [...data.players].sort(() => Math.random() - 0.5);
  const team1    = shuffled.slice(0, half);
  const team2    = shuffled.slice(half);

  const t1Mentions = team1.map((id) => `<@${id}>`).join(", ");
  const t2Mentions = team2.map((id) => `<@${id}>`).join(", ");
  const allMentions = data.players.map((id) => `<@${id}>`).join(" ");

  const teamEmbed = new EmbedBuilder()
    .setTitle(`League ${data.id} — Teams Auto-Assigned!`)
    .setColor(0x57f287)
    .setDescription("The league is full! Teams have been randomly assigned. Good luck!")
    .addFields(
      { name: "Team 1",     value: t1Mentions,     inline: true },
      { name: "Team 2",     value: t2Mentions,     inline: true },
      { name: "Format",     value: data.format,    inline: true },
      { name: "Match Type", value: data.matchType, inline: true },
      { name: "Perks",      value: data.perks,     inline: true },
      { name: "Region",     value: data.region,    inline: true },
    )
    .setTimestamp();

  if (!data.threadId) {
    try {
      const ch = await client.channels.fetch(data.channelId);

      let thread;
      try {
        thread = await ch.threads.create({
          name: `League ${data.id}`,
          type: ChannelType.PrivateThread,
          invitable: false,
          reason: `Private thread for league ${data.id}`,
        });
      } catch (privateErr) {
        console.warn(`[League ${data.id}] Private thread failed, falling back to public thread:`, privateErr?.message ?? privateErr);
        thread = await ch.threads.create({
          name: `League ${data.id}`,
          type: ChannelType.PublicThread,
          reason: `Thread for league ${data.id}`,
        });
      }

      data.threadId = thread.id;
      saveDB(db);

      // Add all players with explicit view/send permissions
      for (const playerId of data.players) {
        try {
          await thread.members.add(playerId);
          await thread.permissionOverwrites.edit(playerId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });
        } catch (err) {
          console.error(`Failed to set permissions for ${playerId}:`, err);
        }
      }

      await thread.send({ content: allMentions, embeds: [teamEmbed] });
    } catch (err) {
      console.error(`[League ${data.id}] Failed to create thread:`, err);
    }
  } else {
    try {
      const thread = await client.channels.fetch(data.threadId);

      // Ensure all players have send permissions in the existing thread
      for (const playerId of data.players) {
        try {
          await thread.members.add(playerId);
          await thread.permissionOverwrites.edit(playerId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          });
        } catch (err) {
          console.error(`Failed to set permissions for ${playerId}:`, err);
        }
      }

      await thread.send({ content: allMentions, embeds: [teamEmbed] });
    } catch (err) {
      console.error(`[League ${data.id}] Failed to update thread:`, err);
    }
  }

  try {
    const ch  = await client.channels.fetch(data.channelId);
    const msg = await ch.messages.fetch(data.messageId);
    const fullEmbed = buildLeagueEmbed(data.id, data.format, data.matchType, data.perks, data.region, data.hostId, data.maxPlayers, data.players)
      .setFooter({ text: "League is full — teams auto-assigned!" })
      .setColor(0xffd700);
    await msg.edit({ embeds: [fullEmbed], components: [] });
  } catch (err) {
    console.error(`Failed to update league message for ${data.id}:`, err);
  }
}

function buildLeagueEmbed(id, format, matchType, perks, region, hostId, maxPlayers, players) {
  return new EmbedBuilder()
    .setTitle("League Available")
    .setColor(0x5865f2)
    .addFields(
      { name: "Format",     value: format,                                        inline: true },
      { name: "Match Type", value: matchType,                                     inline: true },
      { name: "Perks",      value: perks,                                         inline: true },
      { name: "Region",     value: region,                                        inline: true },
      { name: "Host",       value: `<@${hostId}>`,                                inline: true },
      { name: "Spots Left", value: formatSpotsLeft(players.length, maxPlayers),   inline: true },
      { name: "Players",    value: players.map((id) => `<@${id}>`).join(", ") || "None" },
      { name: "League ID",  value: `\`${id}\`` },
    )
    .setFooter({ text: `Cancel: /league cancel id:${id}` })
    .setTimestamp();
}

function randomLeagueId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ═════════════════════════════════════════════════════════════════════════════
//  KEEPALIVE HTTP SERVER
// ═════════════════════════════════════════════════════════════════════════════
http.createServer((req, res) => res.end("MVC League Bot — Online")).listen(PORT, () => {
  console.log(`HTTP keepalive on port ${PORT}`);
});

// ═════════════════════════════════════════════════════════════════════════════
//  LOGIN
// ═════════════════════════════════════════════════════════════════════════════
if (!TOKEN) {
  console.error("DISCORD_BOT_TOKEN is not set.");
  process.exit(1);
}

client.login(TOKEN).catch((err) => {
  console.error("Failed to login:", err);
  process.exit(1);
});
