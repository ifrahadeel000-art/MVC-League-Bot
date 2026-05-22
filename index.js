e(ButtonStyle.Danger),
    );

    try {
      const host = await client.users.fetch(data.hostId);
      await host.send({ embeds: [formEmbed], components: [row] });
      return interaction.reply({ content: "Signup submitted! The host will review it shortly.", flags: 64 });
    } catch {
      return interaction.reply({ content: "Signup submitted but couldn't DM the host (DMs may be closed).", flags: 64 });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GIVEAWAY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════════
//  TOURNAMENT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════════
//  LEAGUE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
async function updateLeagueMessage(data) {
  try {
    const ch    = await client.channels.fetch(data.channelId);
    const msg   = await ch.messages.fetch(data.messageId);
    const embed = buildLeagueEmbed(data.id, data.format, data.matchType, data.perks, data.region, data.hostId, data.maxPlayers, data.players);
    const components = data.players.length >= data.maxPlayers ? [] : msg.components;
    await msg.edit({ embeds: [embed], components });
  } catch {}
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

  // Try to create a private thread for the league
  if (!data.threadId) {
    try {
      const ch = await client.channels.fetch(data.channelId);
      const thread = await ch.threads.create({
        name: `League ${data.id}`,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Private thread for league ${data.id}`,
      });
      data.threadId = thread.id;
      saveDB(db);

      for (const playerId of data.players) {
        await thread.members.add(playerId).catch(() => {});
      }

      await thread.send({ content: allMentions, embeds: [teamEmbed] });
    } catch (err) {
      console.error(`[League ${data.id}] Failed to create private thread:`, err?.message ?? err);
      // Fallback: post teams in the main channel with pings so players still get notified
      try {
        const ch = await client.channels.fetch(data.channelId);
        await ch.send({ content: allMentions, embeds: [teamEmbed] });
      } catch (err2) {
        console.error(`[League ${data.id}] Fallback channel send also failed:`, err2?.message ?? err2);
      }
    }
  } else {
    // Thread already exists — just send the team message
    try {
      const thread = await client.channels.fetch(data.threadId);
      await thread.send({ content: allMentions, embeds: [teamEmbed] });
    } catch {}
  }

  // Update main league embed to show full / teams assigned
  try {
    const ch  = await client.channels.fetch(data.channelId);
    const msg = await ch.messages.fetch(data.messageId);
    const fullEmbed = buildLeagueEmbed(data.id, data.format, data.matchType, data.perks, data.region, data.hostId, data.maxPlayers, data.players)
      .setFooter({ text: "League is full — teams auto-assigned!" })
      .setColor(0xffd700);
    await msg.edit({ embeds: [fullEmbed], components: [] });
  } catch {}
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

// ═══════════════════════════════════════════════════════════════════════════════
//  KEEPALIVE HTTP SERVER
// ═══════════════════════════════════════════════════════════════════════════════
http.createServer((req, res) => res.end("MVC League Bot — Online")).listen(PORT, () => {
  console.log(`HTTP keepalive on port ${PORT}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════════════════════════════
if (!TOKEN) {
  console.error("DISCORD_BOT_TOKEN is not set.");
  process.exit(1);
}

client.login(TOKEN).catch((err) => {
  console.error("Failed to login:", err);
  process.exit(1);
});
