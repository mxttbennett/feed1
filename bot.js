if (!process.env.PWD) {
  process.env.PWD = process.cwd();
}

const http = require(`http`);
const express = require(`express`);
const fs = require(`fs`);
const { Client, Collection } = require(`discord.js`);
const config = require(`./config.json`);
const DBL = require(`dblapi.js`);
const { createBackup } = require('./backup_db');
const path = require('path');

// Channel IDs for notifications
const STATUS_CHANNEL_ID = '1350523912085311560';
const ERROR_CHANNEL_ID = '1350524158915776604';
const BACKUP_CHANNEL_ID = '1350523912085311560';

// Create client with required intents and partials
const client = new Client({
  restTimeOffset: 0,
  restWsBridgeTimeout: 100,
  retryLimit: 10,
  presence: {
    status: 'online',
    activities: [{
      name: 'music | -help',
      type: 'LISTENING'
    }]
  }
});

// Add reconnection handling
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
const RECONNECT_INTERVAL = 5000; // 5 seconds

async function sendStatusMessage(message) {
  try {
    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (channel) await channel.send(message);
  } catch (err) {
    console.error('Failed to send status message:', err);
  }
}

async function sendErrorMessage(error) {
  try {
    const channel = await client.channels.fetch(ERROR_CHANNEL_ID);
    if (channel) {
      let errorMsg;
      if (error.endpoint) {
        // Last.fm API error
        errorMsg = `**Last.fm API Error**\n` +
          `**Endpoint:** ${error.endpoint}\n` +
          `**Status:** ${error.statusCode || 'Unknown'}\n` +
          `**Message:** ${error.message}\n` +
          (error.response ? `**Response:** ${error.response.substring(0, 1500)}...\n` : '') +
          `\`\`\`${error.stack || 'No stack trace available'}\`\`\``;
      } else {
        // Regular error
        errorMsg = typeof error === 'string' ? error : 
          `**Error:** ${error.message}\n\`\`\`${error.stack || 'No stack trace available'}\`\`\``;
      }
      await channel.send(errorMsg);
    }
  } catch (err) {
    console.error('Failed to send error message:', err);
  }
}

client.on('disconnect', async (event) => {
  const msg = `Bot disconnected with code ${event.code}. Attempting to reconnect...`;
  console.log(msg);
  await sendStatusMessage(`⚠️ ${msg}`);
  tryReconnect();
});

client.on('error', async (error) => {
  console.error('Discord client error:', error);
  await sendErrorMessage(error);
  if (!client.isReady()) {
    tryReconnect();
  }
});

async function tryReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    const msg = 'Max reconnection attempts reached. Please check your connection and restart the bot.';
    console.error(msg);
    await sendErrorMessage(msg);
    process.exit(1);
  }

  reconnectAttempts++;
  const msg = `Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`;
  console.log(msg);
  await sendStatusMessage(`🔄 ${msg}`);

  try {
    await client.destroy();
    await client.login(config.discordToken);
    console.log('Successfully reconnected!');
    await sendStatusMessage('✅ Successfully reconnected to Discord!');
    reconnectAttempts = 0; // Reset counter on successful reconnection
  } catch (error) {
    console.error('Reconnection failed:', error);
    await sendErrorMessage(error);
    setTimeout(tryReconnect, RECONNECT_INTERVAL);
  }
}

// Add heartbeat monitoring
let lastHeartbeat = Date.now();
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

setInterval(async () => {
  if (client.ws.status === 0) { // 0 = READY
    lastHeartbeat = Date.now();
  } else {
    const timeSinceHeartbeat = Date.now() - lastHeartbeat;
    if (timeSinceHeartbeat > HEARTBEAT_INTERVAL * 2) {
      const msg = 'No heartbeat detected for too long, attempting to reconnect...';
      console.log(msg);
      await sendStatusMessage(`💔 ${msg}`);
      tryReconnect();
    }
  }
}, HEARTBEAT_INTERVAL);

client.on('ready', async () => {
  const msg = `Bot reconnected and ready! Logged in as ${client.user.tag}`;
  console.log(msg);
  await sendStatusMessage(`🟢 ${msg}`);
  lastHeartbeat = Date.now();

  // Initialize continuous queue processing
  const QUEUES_CHANNEL_ID = '698299031540989983';
  const queuesChannel = await client.channels.fetch(QUEUES_CHANNEL_ID);
  if (!queuesChannel) {
    console.error('Could not find queues channel');
    return;
  }

  // Start album queue processor
  const albqCommand = client.commands.get('albq');
  if (albqCommand) {
    // Construct a proper message object
    const fakeMessage = {
      channel: queuesChannel,
      member: {
        id: '175199958314516480',
        displayColor: '#000000',
        guild: queuesChannel.guild,
        user: {
          id: '175199958314516480',
          username: 'FMcord',
          discriminator: '0000'
        }
      },
      guild: queuesChannel.guild,
      author: {
        id: '175199958314516480',
        username: 'FMcord',
        discriminator: '0000'
      },
      reply: async (msg) => queuesChannel.send(msg)
    };

    albqCommand.run(client, fakeMessage, ['--r']);
  }

  // Start artist queue processor
  const artqCommand = client.commands.get('artq');
  if (artqCommand) {
    // Use the same message object for artist queue
    const fakeMessage = {
      channel: queuesChannel,
      member: {
        id: '175199958314516480',
        displayColor: '#000000',
        guild: queuesChannel.guild,
        user: {
          id: '175199958314516480',
          username: 'FMcord',
          discriminator: '0000'
        }
      },
      guild: queuesChannel.guild,
      author: {
        id: '175199958314516480',
        username: 'FMcord',
        discriminator: '0000'
      },
      reply: async (msg) => queuesChannel.send(msg)
    };

    artqCommand.run(client, fakeMessage, ['--r']);
  }
});

const app = express();

app.get(`/`, (request, response) => {
  console.log(Date.now() + ` Ping Received`);
  response.sendStatus(200);
});
app.listen(process.env.PORT);
setInterval(() => {
  http.get(`http://${process.env.PROJECT_DOMAIN}.glitch.me/`);
}, 280000);

const Sequelize = require(`sequelize`);

const sequelize = new Sequelize(`database`, `user`, `password`, {
  host: `localhost`,
  dialect: `sqlite`,
  logging: false,
  storage: `.data/database.sqlite`
});

// Add these model imports
const Users = require('./src/models/Users.js')(sequelize, Sequelize.DataTypes);
const Artists = require('./src/models/Artists.js')(sequelize, Sequelize.DataTypes);
const Albums = require('./src/models/Albums.js')(sequelize, Sequelize.DataTypes);
const Crowns = require('./src/models/Crowns.js')(sequelize, Sequelize.DataTypes);
const ACrowns = require('./src/models/ACrowns.js')(sequelize, Sequelize.DataTypes);
const Notifs = require('./src/models/Notifs.js')(sequelize, Sequelize.DataTypes);
const WNotifs = require('./src/models/WNotifs.js')(sequelize, Sequelize.DataTypes);
const Time = require('./src/models/Time.js')(sequelize, Sequelize.DataTypes);
const ArtistQueue = require('./src/models/ArtistQueue.js')(sequelize, Sequelize.DataTypes);
const AlbumQueue = require('./src/models/AlbumQueue.js')(sequelize, Sequelize.DataTypes);

// Remove or comment out this block since we're syncing later
/* sequelize.sync({ force: true }).then(() => {
  console.log('Database & tables created!');
}).catch(err => {
  console.error('Error syncing database:', err);
}); */

client.config = config;
client.commands = new Collection();
client.sequelize = sequelize;
client.snippets = require(`./snippets.js`);

if (process.argv[2] !== `--no-dbl`) {
  /*
  const dbl = new DBL(config.dbl.apikey, client);

  dbl.on(`posted`, () => {
    console.log(`Server count posted to discordbots.org!`);
  });

  dbl.on(`error`, e => {
    console.error(`DBL error: ${e}`);
  });
  */
}

fs.readdir(`./src/commands/`, (err, files) => {
  if (err) throw err;
  files.forEach(file => {
    const fileName = file.split(`.`)[0];
    const props = require(`./src/commands/${file}`);
    client.commands.set(fileName, props);
  });
});

fs.readdir(`./src/events/`, (err, files) => {
  if (err) throw err;
  files.forEach(file => {
    const eventName = file.split(`.`)[0];
    const func = require(`./src/events/${file}`);
    client.on(eventName, func.bind(null, client));
  });
});

fs.readdir(`./src/models/`, (err, files) => {
  if (err) {
    console.error('Error reading models directory:', err);
    throw err;
  }

  console.log('Starting database sync process...');

  // Wrap database operations in async function
  (async () => {
    try {
      // Create backup of current database
      const dbPath = '.data/database.sqlite';
      const backupPath = '.data/database.sqlite.backup';
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
        console.log('Created database backup at:', backupPath);
      }

      // For SQLite, we need to recreate the table without the constraint
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS times_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ms TEXT NOT NULL,
          isArtist TEXT NOT NULL,
          isAlbum TEXT DEFAULT 'false',
          guildID TEXT NOT NULL,
          createdAt DATETIME,
          updatedAt DATETIME
        )
      `);

      // Copy data from old table if it exists
      await sequelize.query(`
        INSERT OR IGNORE INTO times_new 
        SELECT * FROM times
      `).catch(() => console.log('No existing times table to copy from'));

      // Drop old table and rename new one
      await sequelize.query('DROP TABLE IF EXISTS times');
      await sequelize.query('ALTER TABLE times_new RENAME TO times');

      console.log('Database schema updated successfully');

      // Continue with model sync - but without altering tables
      const syncPromises = files.map(file => {
        if (!file.endsWith('.js')) return Promise.resolve();
        console.log(`Syncing model from file: ${file}`);
        const model = require(`./src/models/${file}`)(sequelize, Sequelize.DataTypes);
        return model.sync({
          alter: false,
          force: false
        }).catch(err => {
          console.warn(`Warning: Failed to sync ${file}, continuing anyway:`, err.message);
          return Promise.resolve();
        });
      });

      await Promise.all(syncPromises);
      console.log('All models synchronized successfully');
      console.log('Attempting Discord login...');
      await client.login(config.discordToken);
      console.log(`I'm in.`);

      // After client login is successful, set up backup interval
      console.log('Setting up automated backups...');
      
      // Get the backup notification channel
      const backupChannel = await client.channels.fetch(BACKUP_CHANNEL_ID);
      if (!backupChannel) {
        console.error('Could not find backup notification channel');
        return;
      }
      
      // Create initial backup
      await createBackup(backupChannel);
      
      // Set up 12-hour interval for backups (12 * 60 * 60 * 1000 = 43200000 ms)
      setInterval(async () => {
        console.log('Creating scheduled backup...');
        await createBackup(backupChannel);
      }, 43200000);
      
      console.log('Automated backup system initialized');
    } catch (err) {
      console.error('Detailed error during sync or login:', err);
      console.error('Error stack:', err.stack);
      
      // If error occurs, try to restore from backup
      const dbPath = '.data/database.sqlite';
      const backupPath = '.data/database.sqlite.backup';
      if (fs.existsSync(backupPath)) {
        console.log('Error occurred, attempting to restore from backup...');
        fs.copyFileSync(backupPath, dbPath);
        console.log('Database restored from backup');
      }
    }
  })();
});

process.on('uncaughtException', async error => {
  console.error('Uncaught Exception:', error);
  await sendErrorMessage(error);
});

// Add unhandled rejection handler
process.on('unhandledRejection', async (error) => {
  console.error('Unhandled Promise Rejection:', error);
  await sendErrorMessage(error);
});
