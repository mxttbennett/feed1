const fs = require('fs');
const csv = require('csv-parse');
const Sequelize = require('sequelize');
const path = require('path');

// Initialize Sequelize
const sequelize = new Sequelize('database', 'user', 'password', {
  host: 'localhost',
  dialect: 'sqlite',
  logging: false,
  storage: '.data/database.sqlite'
});

// Import Users model
const Users = require('./src/models/Users.js')(sequelize, Sequelize.DataTypes);

async function restoreUsers() {
  try {
    // Read and parse CSV file
    const fileContent = fs.readFileSync('.data/users_backup_v2.csv', 'utf-8');
    const records = await new Promise((resolve, reject) => {
      csv.parse(fileContent, {
        columns: true,
        skip_empty_lines: true
      }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });

    console.log(`Found ${records.length} users to restore`);

    // Insert each record
    for (const record of records) {
      try {
        const userData = {
          id: parseInt(record.id),
          discordUserID: record.discordUserID,
          lastFMUsername: record.lastFMUsername || null,
          lastDailyTimestamp: record.lastDailyTimestamp || null,
          dailyPlayCount: parseInt(record.dailyPlayCount) || 0,
          RYMUsername: record.RYMUsername || null,
          RYMPerpage: parseInt(record.RYMPerpage) || 0,
          RYMmax: parseInt(record.RYMmax) || 0,
          RYMmaxplus: parseInt(record.RYMmaxplus) || 0,
          Wishmax: parseInt(record.Wishmax) || 0,
          Tagmax: parseInt(record.Tagmax) || 0,
          Tag: record.Tag || null,
          Chart: record.Chart || null,
          createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
          updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date()
        };

        // Try to create first
        try {
          await Users.create(userData);
          console.log(`Created user: ${record.discordUserID} (${record.lastFMUsername || 'No LastFM'})`);
        } catch (createErr) {
          // If creation fails, try to update
          const [numRows] = await Users.update(userData, {
            where: { discordUserID: record.discordUserID }
          });
          
          if (numRows > 0) {
            console.log(`Updated existing user: ${record.discordUserID} (${record.lastFMUsername || 'No LastFM'})`);
          } else {
            console.log(`Failed to restore user: ${record.discordUserID}`);
          }
        }
      } catch (err) {
        console.error(`Error processing user ${record.discordUserID}:`, err.message);
      }
    }

    console.log('User restoration complete!');
    process.exit(0);
  } catch (err) {
    console.error('Error during restoration:', err);
    process.exit(1);
  }
}

// Run the restoration
restoreUsers(); 