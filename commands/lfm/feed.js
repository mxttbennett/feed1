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

                        // const trackArtist = track.artist['#text'].replace('*', '\*') ?? null;
                        // const trackAlbum = track.album['#text'].replace('\*') ?? null


                        trackStream.on('nowPlaying', async (track) => {
                            const exampleEmbed = new EmbedBuilder()
                                .setColor(interaction.member.displayColor)
                                .setTitle(track.name)
                                .setURL('https://discord.js.org/')
                                .setAuthor({ name: interaction.user.username, iconURL: interaction.member.displayAvatarURL(), url: 'https://www.last.fm/user/dankjankem' })
                                // .setDescription(`[**${track.artist[`#text`]}**](http://www.google.com/search?q=${art}&as_sitesearch=rateyourmusic.com 'search rym for ${origart}')\n` +
                                //     `[***${track.album[`#text`] ?? `[no album]`}***](http://www.google.com/search?q=${art}${alb}&as_sitesearch=rateyourmusic.com 'search rym for ${origart} - ${origalb}')`, true)
                                .setThumbnail(track.image[3]['#text'])
                                .setTimestamp()
                                .setFooter({ text: 'Some footer text here', iconURL: 'https://i.imgur.com/AfFp7pu.png' });

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
                // if "stop" option selected, stop the stream and set the global instance to null
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