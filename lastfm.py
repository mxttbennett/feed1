
import os
import pylast
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Authentication for Last.fm
API_KEY = os.getenv('LASTFM_API_KEY')
API_SECRET = os.getenv('LASTFM_API_SECRET')

# Create a Last.fm network object
network = pylast.LastFMNetwork(api_key=API_KEY, api_secret=API_SECRET)

def get_now_playing(username):
    user = network.get_user(username)
    now_playing = user.get_now_playing()
    return now_playing.artist.get_name() + " - " + now_playing.title if now_playing else "Nothing is playing right now."
