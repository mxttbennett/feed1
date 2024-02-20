import os
from dotenv import load_dotenv

import discord

from lastfm import *  # Importing all functions from lastfm.py

load_dotenv()

async def now_playing_cmd(interaction: discord.Interaction, username: str):
    response = get_now_playing(username)
    await interaction.response.send_message(response)

async def top_artists_cmd(interaction: discord.Interaction, username: str):
    response = get_top_artists(username)
    await interaction.response.send_message(response)

async def recent_tracks_cmd(interaction: discord.Interaction, username: str):
    response = get_recent_tracks(username)
    await interaction.response.send_message(response)

async def loved_tracks_cmd(interaction: discord.Interaction, username: str):
    response = get_loved_tracks(username)
    await interaction.response.send_message(response)

async def top_tracks_cmd(interaction: discord.Interaction, username: str):
    response = get_top_tracks(username)
    await interaction.response.send_message(response)

async def top_albums_cmd(interaction: discord.Interaction, username: str):
    response = get_top_albums(username)
    await interaction.response.send_message(response)

async def artist_top_tracks_cmd(interaction: discord.Interaction, artist_name: str):
    response = get_artist_top_tracks(artist_name)
    await interaction.response.send_message(response)

async def artist_top_albums_cmd(interaction: discord.Interaction, artist_name: str):
    response = get_artist_top_albums(artist_name)
    await interaction.response.send_message(response)

async def album_info_cmd(interaction: discord.Interaction, artist_name: str, album_name: str):
    response = get_album_info(artist_name, album_name)
    await interaction.response.send_message(response)

async def track_info_cmd(interaction: discord.Interaction, artist_name: str, track_name: str):
    response = get_track_info(artist_name, track_name)
    await interaction.response.send_message(response)

async def artist_info_cmd(interaction: discord.Interaction, artist_name: str):
    response = get_artist_info(artist_name)
    await interaction.response.send_message(response)

async def user_info_cmd(interaction: discord.Interaction, username: str):
    response = get_user_info(username)
    await interaction.response.send_message(response)

async def user_friends_cmd(interaction: discord.Interaction, username: str):
    response = get_user_friends(username)
    await interaction.response.send_message(response)

async def user_top_tags_cmd(interaction: discord.Interaction, username: str):
    response = get_user_top_tags(username)
    await interaction.response.send_message(response)

async def artist_tags_cmd(interaction: discord.Interaction, artist_name: str):
    response = get_artist_tags(artist_name)
    await interaction.response.send_message(response)
