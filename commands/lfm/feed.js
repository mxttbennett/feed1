const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { lastfmKey, lastfmSecret, users } = require.main.require('./config.json')
var LastFmNode = require('lastfm').LastFmNode;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('feed')
        .setDescription('Initializes a feed that reports now playing tracks for server users')
        .addStringOption(option =>
            option.setName('cmd')
                .setDescription('The input to echo back')
                .addChoices({ name: 'start', value: 'start' }, { name: 'stop', value: 'stop' })
        ),
    async execute(interaction) {
        try {
            // inside a command, event listener, etc.
            const exampleEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('Some title')
                .setURL('https://discord.js.org/')
                .setAuthor({ name: 'Some name', iconURL: 'https://i.imgur.com/AfFp7pu.png', url: 'https://discord.js.org' })
                .setDescription('Some description here')
                .setThumbnail('https://i.imgur.com/AfFp7pu.png')
                .addFields(
                    { name: 'Regular field title', value: 'Some value here' },
                    { name: '\u200B', value: '\u200B' },
                    { name: 'Inline field title', value: 'Some value here', inline: true },
                    { name: 'Inline field title', value: 'Some value here', inline: true },
                )
                .addFields({ name: 'Inline field title', value: 'Some value here', inline: true })
                .setImage('https://i.imgur.com/AfFp7pu.png')
                .setTimestamp()
                .setFooter({ text: 'Some footer text here', iconURL: 'https://i.imgur.com/AfFp7pu.png' });


            const cmdOption = interaction.options.getString('cmd');

            if (cmdOption === null || (cmdOption.trim().toLowerCase() !== 'start' && cmdOption.trim().toLowerCase() !== 'stop')) {
                console.log(cmdOption)
                await interaction.reply('Error: must specify a launch option (cmd param).');
            }
            else if (cmdOption.toLowerCase() === 'start') {
                // only start the now playing feed if an instance doesn't already exist
                if (!global.trackStreamInstance) {
                    var lastfm = new LastFmNode({
                        api_key: lastfmKey,
                        secret: lastfmSecret,
                    });

                    await interaction.reply('Now logging now playing scrobbles for user group:');

                    users.forEach((user) => {
                        var trackStream = lastfm.stream(user);

                        trackStream.on('nowPlaying', async (track) => {
                            await interaction.channel.send(`${user} now playing: ${track.name}`);
                            await interaction.channel.send({ embeds: [exampleEmbed] });
                        });

                        global.trackStreamInstance = trackStream;
                        global.trackStreamInstance.start();
                    })
                }
                else {
                    await interaction.reply('A now playing feed has already been initialized.');
                }
            }
            else {
                if (global.trackStreamInstance) {
                    global.trackStreamInstance.stop();
                    global.trackStreamInstance = null;
                    await interaction.reply('Closed the now playing feed.');
                }
                else {
                    await interaction.reply('No feed is currently running.');
                }
            }


        }
        catch (e) {
            console.log(e.message)
        }
    },
};