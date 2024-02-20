import os
from dotenv import load_dotenv

import discord
from discord.ext import commands

import bot_commands

load_dotenv()

# Define intents
intents = discord.Intents.default()

# Create an instance of the bot with the defined intents
bot = commands.Bot(command_prefix='!', intents=intents)

def register_commands(bot):
    bot.command(name='nowplaying')(bot_commands.now_playing_cmd)
    bot.command(name='topartists')(bot_commands.top_artists_cmd)
    bot.command(name='recenttracks')(bot_commands.recent_tracks_cmd)
    bot.command(name='lovedtracks')(bot_commands.loved_tracks_cmd)
    bot.command(name='toptracks')(bot_commands.top_tracks_cmd)
    bot.command(name='topalbums')(bot_commands.top_albums_cmd)
    bot.command(name='artisttoptracks')(bot_commands.artist_top_tracks_cmd)
    bot.command(name='artisttopalbums')(bot_commands.artist_top_albums_cmd)
    bot.command(name='albuminfo')(bot_commands.album_info_cmd)
    bot.command(name='trackinfo')(bot_commands.track_info_cmd)
    bot.command(name='artistinfo')(bot_commands.artist_info_cmd)
    bot.command(name='userinfo')(bot_commands.user_info_cmd)
    bot.command(name='userfriends')(bot_commands.user_friends_cmd)
    bot.command(name='usertoptags')(bot_commands.user_top_tags_cmd)
    bot.command(name='artisttags')(bot_commands.artist_tags_cmd)
    # Add more commands here as needed, following the same pattern

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user.name}')
    register_commands(bot)  # This will register all the commands when the bot is ready


# Use the Discord bot token from the .env file
bot.run(os.getenv('DISCORD_BOT_TOKEN'))