import os
from dotenv import load_dotenv

import pylast
from lastfm import *  # Importing all functions from lastfm.py

load_dotenv()

# Initialize the Last.fm network with your credentials
network = pylast.LastFMNetwork(api_key=os.getenv('LASTFM_API_KEY'), api_secret=os.getenv('LASTFM_API_SECRET'))

def get_now_playing(username):
    user = network.get_user(username)
    now_playing = user.get_now_playing()
    return f"{now_playing.artist} - {now_playing.title}" if now_playing else "No track currently playing."

def get_top_artists(username, limit=5):
    user = network.get_user(username)
    top_artists = user.get_top_artists(limit=limit)
    return ', '.join([artist.item.name for artist in top_artists])

def get_recent_tracks(username, limit=5):
    user = network.get_user(username)
    recent_tracks = user.get_recent_tracks(limit=limit)
    return ', '.join([f"{track.track.artist} - {track.track.title}" for track in recent_tracks])

def get_loved_tracks(username, limit=5):
    user = network.get_user(username)
    loved_tracks = user.get_loved_tracks(limit=limit)
    return ', '.join([f"{track.track.artist} - {track.track.title}" for track in loved_tracks])

def get_top_tracks(username, limit=5):
    user = network.get_user(username)
    top_tracks = user.get_top_tracks(limit=limit)
    return ', '.join([f"{track.item.artist} - {track.item.title}" for track in top_tracks])

def get_top_albums(username, limit=5):
    user = network.get_user(username)
    top_albums = user.get_top_albums(limit=limit)
    return ', '.join([f"{album.item.artist} - {album.item.title}" for album in top_albums])

def get_artist_top_tracks(artist_name, limit=5):
    artist = network.get_artist(artist_name)
    top_tracks = artist.get_top_tracks(limit=limit)
    return ', '.join([track.item.title for track in top_tracks])

def get_artist_top_albums(artist_name, limit=5):
    artist = network.get_artist(artist_name)
    top_albums = artist.get_top_albums(limit=limit)
    return ', '.join([album.item.title for album in top_albums])

def get_album_info(artist_name, album_name):
    album = network.get_album(artist_name, album_name)
    return f"{album.get_artist()} - {album.get_title()} : {album.get_release_date()}"

def get_track_info(artist_name, track_name):
    track = network.get_track(artist_name, track_name)
    return f"{track.get_artist()} - {track.get_title()} : {track.get_duration()} seconds"

def get_artist_info(artist_name):
    artist = network.get_artist(artist_name)
    return f"{artist.get_name()} : {artist.get_bio_summary()}"

def get_user_info(username):
    user = network.get_user(username)
    return f"{user.get_name()} : {user.get_country()}, Playcount: {user.get_playcount()}"

def get_user_friends(username, limit=5):
    user = network.get_user(username)
    friends = user.get_friends(limit=limit)
    return ', '.join([friend.get_name() for friend in friends])

def get_user_top_tags(username, limit=5):
    user = network.get_user(username)
    top_tags = user.get_top_tags(limit=limit)
    return ', '.join([tag.item.name for tag in top_tags])

def get_artist_tags(artist_name):
    artist = network.get_artist(artist_name)
    tags = artist.get_top_tags()
    return ', '.join([tag.item.name for tag in tags])

def get_album_info(artist_name, album_name):
    album = network.get_album(artist_name, album_name)
    return f"{album.get_artist()} - {album.get_title()} : {album.get_release_date()}"

def get_track_info(artist_name, track_name):
    track = network.get_track(artist_name, track_name)
    return f"{track.get_artist()} - {track.get_title()} : {track.get_duration()} seconds"

def get_artist_info(artist_name):
    artist = network.get_artist(artist_name)
    return f"{artist.get_name()} : {artist.get_bio_summary()}"

def get_user_info(username):
    user = network.get_user(username)
    return f"{user.get_name()} : {user.get_country()}, Playcount: {user.get_playcount()}"

def get_user_friends(username, limit=5):
    user = network.get_user(username)
    friends = user.get_friends(limit=limit)
    return ', '.join([friend.get_name() for friend in friends])

def get_user_top_tags(username, limit=5):
    user = network.get_user(username)
    top_tags = user.get_top_tags(limit=limit)
    return ', '.join([tag.item.name for tag in top_tags])

def get_artist_tags(artist_name):
    artist = network.get_artist(artist_name)
    tags = artist.get_top_tags()
    return ', '.join([tag.item.name for tag in tags])

def get_album_info(artist_name, album_name):
    album = network.get_album(artist_name, album_name)
    return f"{album.get_artist()} - {album.get_title()} : {album.get_release_date()}"

def get_track_info(artist_name, track_name):
    track = network.get_track(artist_name, track_name)
    return f"{track.get_artist()} - {track.get_title()} : {track.get_duration()} seconds"

def get_artist_info(artist_name):
    artist = network.get_artist(artist_name)
    return f"{artist.get_name()} : {artist.get_bio_summary()}"

def get_user_info(username):
    user = network.get_user(username)
    return f"{user.get_name()} : {user.get_country()}, Playcount: {user.get_playcount()}"

def get_user_friends(username, limit=5):
    user = network.get_user(username)
    friends = user.get_friends(limit=limit)
    return ', '.join([friend.get_name() for friend in friends])

def get_user_top_tags(username, limit=5):
    user = network.get_user(username)
    top_tags = user.get_top_tags(limit=limit)
    return ', '.join([tag.item.name for tag in top_tags])

def get_artist_tags(artist_name):
    artist = network.get_artist(artist_name)
    tags = artist.get_top_tags()
    return ', '.join([tag.item.name for tag in tags])
