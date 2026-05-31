require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  REST,
  Routes,
} = require('discord.js');

const fs = require('fs');

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID environment variables.');
  process.exit(1);
}

const DB_PATH           = './database.json';

// League
const LEAGUE_CHANNEL_ID = '1501829215291703378';
const LEAGUES_PING_ROLE = '1501829213928554565';
const LEAGUE_HOST_ROLE  = '1500064722312233050';

// Clan War
const CW_CHANNEL_ID     = '1495844004234006558';
const CW_HOST_ROLE      = '1499802432077693038';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { leagues: {}, clanwars: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!data.clanwars) data.clanwars = {};
  return data;
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function leagueMaxPlayers(format) {
  return { '2v2': 4, '3v3': 6, '4v4': 8 }[format];
}

function cwMaxPlayers(format) {
  return { '3v3': 3, '4v4': 4 }[format];
}

// ── Discord Client ────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

// ── Register Commands ─────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`Online: ${client.user.tag}`);

  const leagueCmd = new SlashCommandBuilder()
    .setName('league')
    .setDescription('League management')
    .addSubcommand(sub =>
      sub
        .setName('host')
        .setDescription('Host a league')
        .addStringOption(o =>
          o.setName('format').setDescription('Match format').setRequired(true)
            .addChoices(
              { name: '2v2', value: '2v2' },
              { name: '3v3', value: '3v3' },
              { name: '4v4', value: '4v4' },
            )
        )
        .addStringOption(o =>
          o.setName('match_type').setDescription('Match type').setRequired(true)
            .addChoices(
              { name: 'Swift Game', value: 'Swift Game' },
              { name: 'War Game',   value: 'War Game'   },
            )
        )
        .addStringOption(o =>
          o.setName('perks').setDescription('Match perks').setRequired(true)
            .addChoices(
              { name: 'Perks',    value: 'Perks'    },
              { name: 'No Perks', value: 'No Perks' },
            )
        )
        .addStringOption(o =>
          o.setName('region').setDescription('Region').setRequired(true)
            .addChoices(
              { name: 'Europe',        value: 'Europe'        },
              { name: 'Asia',          value: 'Asia'          },
              { name: 'North America', value: 'North America' },
              { name: 'South America', value: 'South America' },
              { name: 'Ocean',         value: 'Ocean'         },
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('join')
        .setDescription('Join an active league')
        .addStringOption(o => o.setName('id').setDescription('League ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Cancel a league (League Host role required)')
        .addStringOption(o => o.setName('id').setDescription('League ID').setRequired(true))
    );

  const clanwarCmd = new SlashCommandBuilder()
    .setName('clanwar')
    .setDescription('Clan war management')
    .addSubcommand(sub =>
      sub
        .setName('host')
        .setDescription('Host a clan war')
        .addIntegerOption(o =>
          o.setName('ft').setDescription('First to (e.g. 3)').setRequired(true).setMinValue(1).setMaxValue(20)
        )
        .addStringOption(o =>
          o.setName('format').setDescription('Match format').setRequired(true)
            .addChoices(
              { name: '3v3', value: '3v3' },
              { name: '4v4', value: '4v4' },
            )
        )
        .addStringOption(o =>
          o.setName('region').setDescription('Region').setRequired(true)
            .addChoices(
              { name: 'EU', value: 'EU' },
              { name: 'AS', value: 'AS' },
              { name: 'NA', value: 'NA' },
              { name: 'SA', value: 'SA' },
              { name: 'OC', value: 'OC' },
            )
        )
        .addStringOption(o =>
          o.setName('against').setDescription('Opposing clan name').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('join')
        .setDescription('Join an active clan war')
        .addStringOption(o => o.setName('id').setDescription('Clan War ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Cancel a clan war (Clan War Host role required)')
        .addStringOption(o => o.setName('id').setDescription('Clan War ID').setRequired(true))
    );

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [leagueCmd.toJSON(), clanwarCmd.toJSON()],
  });
  console.log('Slash commands registered.');
});

// ── League Embed ──────────────────────────────────────────────────────────

function buildLeagueEmbed(league) {
  const playerList = league.players.map(id => `<@${id}>`).join('\n') || 'None';
  const color =
    league.status === 'cancelled' ? 0x7f8c8d :
    league.status === 'full'      ? 0xe74c3c :
    0x5865F2;
  const title =
    league.status === 'cancelled' ? 'League Cancelled' :
    league.status === 'full'      ? 'League Full'      :
    'League Available';

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: 'Format',     value: league.format,                                      inline: true },
      { name: 'Match Type', value: league.type,                                        inline: true },
      { name: 'Perks',      value: league.perks,                                       inline: true },
      { name: 'Region',     value: league.region,                                      inline: true },
      { name: 'Host',       value: `<@${league.hostId}>`,                              inline: true },
      { name: 'Spots Left', value: `${league.players.length} / ${league.maxPlayers}`, inline: true },
      { name: 'Players',    value: playerList,                                         inline: false },
      { name: 'League ID',  value: `${league.id}`,                                    inline: false },
    )
    .setFooter({ text: `Cancel: /league cancel id:${league.id}` })
    .setTimestamp();
}

// ── Clan War Embed ────────────────────────────────────────────────────────

function buildCWEmbed(cw) {
  const playerList = cw.players.map(id => `<@${id}>`).join('\n') || 'None';
  const color =
    cw.status === 'cancelled' ? 0x7f8c8d :
    cw.status === 'full'      ? 0xe74c3c :
    0xE67E22;
  const title =
    cw.status === 'cancelled' ? 'Clan War Cancelled' :
    cw.status === 'full'      ? 'Clan War Full'      :
    'Clan War Available';

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: 'Ft',         value: `First to ${cw.ft}`,                              inline: true },
      { name: 'Format',     value: cw.format,                                        inline: true },
      { name: 'Region',     value: cw.region,                                        inline: true },
      { name: 'Against',    value: cw.against,                                       inline: true },
      { name: 'Host',       value: `<@${cw.hostId}>`,                                inline: true },
      { name: 'Spots Left', value: `${cw.players.length} / ${cw.maxPlayers}`,        inline: true },
      { name: 'Players',    value: playerList,                                       inline: false },
      { name: 'CW ID',      value: `${cw.id}`,                                      inline: false },
    )
    .setFooter({ text: `Cancel: /clanwar cancel id:${cw.id}` })
    .setTimestamp();
}

function buildJoinButton(type, id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${type}_join_${id}`)
      .setLabel(type === 'cw' ? 'Join Clan War' : 'Join League')
      .setStyle(ButtonStyle.Primary)
  );
}

// ── Create League ─────────────────────────────────────────────────────────

async function createLeague(interaction) {
  const format    = interaction.options.getString('format');
  const matchType = interaction.options.getString('match_type');
  const perks     = interaction.options.getString('perks');
  const region    = interaction.options.getString('region');

  await interaction.deferReply({ ephemeral: true });

  const db = readDB();
  let leagueId;
  do { leagueId = generateId(); } while (db.leagues[leagueId]);

  const league = {
    id:         leagueId,
    format,
    type:       matchType,
    perks,
    region,
    hostId:     interaction.user.id,
    maxPlayers: leagueMaxPlayers(format),
    players:    [interaction.user.id],
    messageId:  null,
    threadId:   null,
    status:     'open',
  };

  const ch = await client.channels.fetch(LEAGUE_CHANNEL_ID);

  const thread = await ch.threads.create({
    name:      `League ${leagueId}`,
    type:      ChannelType.PrivateThread,
    invitable: false,
    reason:    `League ${leagueId} by ${interaction.user.username}`,
  });

  await thread.members.add(interaction.user.id);
  await thread.send(
    `**League ${leagueId} - Private Channel**\n\n` +
    `Format: **${format}** | Type: **${matchType}** | Perks: **${perks}** | Region: **${region}**\n` +
    `Host: <@${interaction.user.id}>\n\n` +
    `This thread is private. Only players who join this league will be added here.`
  );

  league.threadId = thread.id;

  const msg = await ch.send({
    embeds:     [buildLeagueEmbed(league)],
    components: [buildJoinButton('league', leagueId)],
  });

  league.messageId = msg.id;
  await ch.send(`<@&${LEAGUES_PING_ROLE}> New league available: **${leagueId}**`);

  db.leagues[leagueId] = league;
  writeDB(db);

  await interaction.editReply({ content: `League **${leagueId}** has been created in <#${LEAGUE_CHANNEL_ID}>.` });
}

// ── Create Clan War ───────────────────────────────────────────────────────

async function createClanWar(interaction) {
  const ft      = interaction.options.getInteger('ft');
  const format  = interaction.options.getString('format');
  const region  = interaction.options.getString('region');
  const against = interaction.options.getString('against');

  await interaction.deferReply({ ephemeral: true });

  const db = readDB();
  let cwId;
  do { cwId = generateId(); } while (db.clanwars[cwId]);

  const cw = {
    id:         cwId,
    ft,
    format,
    region,
    against,
    hostId:     interaction.user.id,
    maxPlayers: cwMaxPlayers(format),
    players:    [interaction.user.id],
    messageId:  null,
    threadId:   null,
    status:     'open',
  };

  const ch = await client.channels.fetch(CW_CHANNEL_ID);

  const thread = await ch.threads.create({
    name:      `CW ${cwId}`,
    type:      ChannelType.PrivateThread,
    invitable: false,
    reason:    `Clan War ${cwId} by ${interaction.user.username}`,
  });

  await thread.members.add(interaction.user.id);
  await thread.send(
    `**Clan War ${cwId} - Private Channel**\n\n` +
    `Ft: **First to ${ft}** | Format: **${format}** | Region: **${region}** | Against: **${against}**\n` +
    `Host: <@${interaction.user.id}>\n\n` +
    `This thread is private. Only players participating in this clan war will be added here.`
  );

  cw.threadId = thread.id;

  const msg = await ch.send({
    embeds:     [buildCWEmbed(cw)],
    components: [buildJoinButton('cw', cwId)],
  });

  cw.messageId = msg.id;

  await ch.send(`<@&1495844281615651047> New clan war available: **${cwId}**`);

  db.clanwars[cwId] = cw;
  writeDB(db);

  await interaction.editReply({ content: `Clan War **${cwId}** has been created in <#${CW_CHANNEL_ID}>.` });
}

// ── Join League ───────────────────────────────────────────────────────────

async function handleLeagueJoin(interaction, leagueId) {
  const db     = readDB();
  const league = db.leagues[leagueId];

  if (!league)                                       return interaction.reply({ content: `No league found with ID **${leagueId}**.`,   ephemeral: true });
  if (league.status === 'cancelled')                 return interaction.reply({ content: `League **${leagueId}** has been cancelled.`, ephemeral: true });
  if (league.status === 'full')                      return interaction.reply({ content: `League **${leagueId}** is full.`,            ephemeral: true });
  if (league.players.includes(interaction.user.id)) return interaction.reply({ content: 'You are already in this league.',           ephemeral: true });

  league.players.push(interaction.user.id);

  try {
    const thread = await client.channels.fetch(league.threadId);
    if (thread) {
      await thread.members.add(interaction.user.id);
      await thread.send(`<@${interaction.user.id}> has joined the league.`);
    }
  } catch (e) { console.error('Thread add error:', e); }

  if (league.players.length >= league.maxPlayers) league.status = 'full';

  try {
    const ch  = await client.channels.fetch(LEAGUE_CHANNEL_ID);
    const msg = await ch.messages.fetch(league.messageId);
    const components = league.status === 'full' ? [] : [buildJoinButton('league', leagueId)];
    await msg.edit({ embeds: [buildLeagueEmbed(league)], components });

    if (league.status === 'full') {
      const thread = await client.channels.fetch(league.threadId).catch(() => null);
      if (thread) await thread.send('All spots are filled. The league is now starting. Good luck to all participants.');
    }
  } catch (e) { console.error('Embed update error:', e); }

  writeDB(db);

  await interaction.reply({ content: `You have joined league **${leagueId}**. Check the private thread for details.`, ephemeral: true });
}

// ── Join Clan War ─────────────────────────────────────────────────────────

async function handleCWJoin(interaction, cwId) {
  const db = readDB();
  const cw = db.clanwars[cwId];

  if (!cw)                                       return interaction.reply({ content: `No clan war found with ID **${cwId}**.`,   ephemeral: true });
  if (cw.status === 'cancelled')                 return interaction.reply({ content: `Clan War **${cwId}** has been cancelled.`, ephemeral: true });
  if (cw.status === 'full')                      return interaction.reply({ content: `Clan War **${cwId}** is full.`,            ephemeral: true });
  if (cw.players.includes(interaction.user.id)) return interaction.reply({ content: 'You are already in this clan war.',       ephemeral: true });

  cw.players.push(interaction.user.id);

  try {
    const thread = await client.channels.fetch(cw.threadId);
    if (thread) {
      await thread.members.add(interaction.user.id);
      await thread.send(`<@${interaction.user.id}> has joined the clan war.`);
    }
  } catch (e) { console.error('CW thread add error:', e); }

  if (cw.players.length >= cw.maxPlayers) cw.status = 'full';

  try {
    const ch  = await client.channels.fetch(CW_CHANNEL_ID);
    const msg = await ch.messages.fetch(cw.messageId);
    const components = cw.status === 'full' ? [] : [buildJoinButton('cw', cwId)];
    await msg.edit({ embeds: [buildCWEmbed(cw)], components });

    if (cw.status === 'full') {
      const thread = await client.channels.fetch(cw.threadId).catch(() => null);
      if (thread) await thread.send('All spots are filled. The clan war is starting. Good luck to all participants.');
    }
  } catch (e) { console.error('CW embed update error:', e); }

  writeDB(db);

  await interaction.reply({ content: `You have joined clan war **${cwId}**. Check the private thread for details.`, ephemeral: true });
}

// ── Cancel League ─────────────────────────────────────────────────────────

async function handleLeagueCancel(interaction, leagueId) {
  const db     = readDB();
  const league = db.leagues[leagueId];

  if (!league)                       return interaction.reply({ content: `No league found with ID **${leagueId}**.`,      ephemeral: true });
  if (league.status === 'cancelled') return interaction.reply({ content: `League **${leagueId}** is already cancelled.`, ephemeral: true });

  league.status = 'cancelled';
  writeDB(db);

  try {
    const ch  = await client.channels.fetch(LEAGUE_CHANNEL_ID);
    const msg = await ch.messages.fetch(league.messageId);
    await msg.edit({ embeds: [buildLeagueEmbed(league)], components: [] });
  } catch (e) { console.error('League cancel embed error:', e); }

  try {
    const thread = await client.channels.fetch(league.threadId).catch(() => null);
    if (thread) {
      await thread.delete(`League ${leagueId} cancelled by ${interaction.user.username}`);
    }
  } catch (e) { console.error('League thread archive error:', e); }

  await interaction.reply({ content: `League **${leagueId}** has been cancelled.`, ephemeral: true });
}

// ── Cancel Clan War ───────────────────────────────────────────────────────

async function handleCWCancel(interaction, cwId) {
  const db = readDB();
  const cw = db.clanwars[cwId];

  if (!cw)                       return interaction.reply({ content: `No clan war found with ID **${cwId}**.`,      ephemeral: true });
  if (cw.status === 'cancelled') return interaction.reply({ content: `Clan War **${cwId}** is already cancelled.`, ephemeral: true });

  cw.status = 'cancelled';
  writeDB(db);

  try {
    const ch  = await client.channels.fetch(CW_CHANNEL_ID);
    const msg = await ch.messages.fetch(cw.messageId);
    await msg.edit({ embeds: [buildCWEmbed(cw)], components: [] });
  } catch (e) { console.error('CW cancel embed error:', e); }

  try {
    const thread = await client.channels.fetch(cw.threadId).catch(() => null);
    if (thread) {
      await thread.delete(`Clan War ${cwId} cancelled by ${interaction.user.username}`);
    }
  } catch (e) { console.error('CW thread archive error:', e); }

  await interaction.reply({ content: `Clan War **${cwId}** has been cancelled.`, ephemeral: true });
}

// ── Interaction Handler ───────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  try {

    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      const sub = interaction.options.getSubcommand();

      // ── /league ─────────────────────────────────────────────────────────────
      if (commandName === 'league') {
        if (sub === 'host') {
          if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE))
            return interaction.reply({ content: 'You do not have permission to host leagues.', ephemeral: true });
          if (interaction.channelId !== LEAGUE_CHANNEL_ID)
            return interaction.reply({ content: `Leagues can only be hosted in <#${LEAGUE_CHANNEL_ID}>.`, ephemeral: true });
          return createLeague(interaction);
        }
        if (sub === 'join')
          return handleLeagueJoin(interaction, interaction.options.getString('id').toUpperCase());
        if (sub === 'cancel') {
          if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE))
            return interaction.reply({ content: 'You do not have permission to cancel leagues.', ephemeral: true });
          return handleLeagueCancel(interaction, interaction.options.getString('id').toUpperCase());
        }
      }

      // ── /clanwar ─────────────────────────────────────────────────────────────
      if (commandName === 'clanwar') {
        if (sub === 'host') {
          if (!interaction.member.roles.cache.has(CW_HOST_ROLE))
            return interaction.reply({ content: 'You do not have permission to host clan wars.', ephemeral: true });
          if (interaction.channelId !== CW_CHANNEL_ID)
            return interaction.reply({ content: `Clan wars can only be hosted in <#${CW_CHANNEL_ID}>.`, ephemeral: true });
          return createClanWar(interaction);
        }
        if (sub === 'join')
          return handleCWJoin(interaction, interaction.options.getString('id').toUpperCase());
        if (sub === 'cancel') {
          if (!interaction.member.roles.cache.has(CW_HOST_ROLE))
            return interaction.reply({ content: 'You do not have permission to cancel clan wars.', ephemeral: true });
          return handleCWCancel(interaction, interaction.options.getString('id').toUpperCase());
        }
      }
    }

    // ── Buttons ───────────────────────────────────────────────────────────────
    else if (interaction.isButton()) {
      if (interaction.customId.startsWith('league_join_'))
        return handleLeagueJoin(interaction, interaction.customId.slice('league_join_'.length));
      if (interaction.customId.startsWith('cw_join_'))
        return handleCWJoin(interaction, interaction.customId.slice('cw_join_'.length));
    }

  } catch (err) {
    console.error('Interaction error:', err);
    try {
      const msg = { content: 'An error occurred. Please try again.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch (_) {}
  }
});

client.login(TOKEN);
