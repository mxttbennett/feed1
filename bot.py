import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
from lastfm import get_now_playing

# Load environment variables
load_dotenv()

# Define intents
intents = discord.Intents.default()

# Create an instance of the bot with the defined intents
bot = commands.Bot(command_prefix='!', intents=intents)

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user.name}')
    # Sync application commands with Discord
    await bot.tree.sync()

@bot.command(name='ping')
async def ping(ctx):
    await ctx.send('Pong!')

@bot.tree.command(name='ping', description='Responds with Pong!')
async def slash_ping(interaction: discord.Interaction):
    await interaction.response.send_message('Pong!')

# Define the now_playing function for the slash command
@bot.tree.command(name='np', description='Shows the currently playing song for a Last.fm user.')
async def slash_now_playing(interaction: discord.Interaction, username: str = 'dankjankem'):
    song = get_now_playing(username)
    if song:
        await interaction.response.send_message(f'{username} is currently playing: {song}')
    else:
        await interaction.response.send_message(f'No song is currently playing for {username}.')

# Use the Discord bot token from the .env file
bot.run(os.getenv('DISCORD_BOT_TOKEN'))
