const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { promisify } = require('util');
const copyFile = promisify(fs.copyFile);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);

// Initialize Sequelize
const sequelize = new Sequelize('database', 'user', 'password', {
  host: 'localhost',
  dialect: 'sqlite',
  logging: false,
  storage: '.data/database.sqlite'
});

// Import Users model
const Users = require('./src/models/Users.js')(sequelize, Sequelize.DataTypes);

async function getTableSizes() {
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: '.data/database.sqlite'
  });

  try {
    // Get size of each table
    const tables = await sequelize.query(
      `SELECT name FROM sqlite_master WHERE type='table'`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    const tableSizes = {};
    for (const { name } of tables) {
      const [{ count }] = await sequelize.query(
        `SELECT COUNT(*) as count FROM "${name}"`,
        { type: Sequelize.QueryTypes.SELECT }
      );
      tableSizes[name] = count;
    }

    return tableSizes;
  } finally {
    await sequelize.close();
  }
}

async function formatBytes(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
}

async function createBackup(channel = null) {
  try {
    // Check if source database exists
    if (!fs.existsSync('.data/database.sqlite')) {
      const errorMsg = '❌ Source database not found at .data/database.sqlite';
      if (channel) await channel.send(errorMsg);
      console.error(errorMsg);
      return false;
    }

    // Create backup directories if they don't exist
    const backupDir = '.data/backups';
    const usersBackupDir = path.join(backupDir, 'users');
    await mkdir(backupDir, { recursive: true });
    await mkdir(usersBackupDir, { recursive: true });

    // Generate timestamp for filenames
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Get table sizes before backup
    const tableSizes = await getTableSizes();
    let sizeReport = '**📊 Database Table Sizes:**\n';
    
    // Sort tables by row count (descending)
    const sortedTables = Object.entries(tableSizes)
      .sort(([,a], [,b]) => b - a);
    
    for (const [table, count] of sortedTables) {
      sizeReport += `- ${table}: ${count.toLocaleString()} rows\n`;
    }

    // Create database backup
    const dbBackupPath = path.join(backupDir, `database_${timestamp}.sqlite`);
    await copyFile('.data/database.sqlite', dbBackupPath);
    
    // Export users table to CSV
    const sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: '.data/database.sqlite'
    });

    const users = await sequelize.query('SELECT * FROM users', {
      type: Sequelize.QueryTypes.SELECT
    });
    
    const csvPath = path.join(usersBackupDir, `users_${timestamp}.csv`);
    const csvContent = users.map(user => 
      Object.values(user).map(val => 
        typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val
      ).join(',')
    );
    
    fs.writeFileSync(csvPath, 
      Object.keys(users[0]).join(',') + '\n' + 
      csvContent.join('\n')
    );

    await sequelize.close();

    // Clean up old backups (keep last 50 for database, unlimited for users)
    const cleanupDirs = [
      { path: backupDir, pattern: /database_.*\.sqlite$/, keep: 50 },
      { path: usersBackupDir, pattern: /users_.*\.csv$/, keep: Infinity }
    ];

    for (const { path: dir, pattern, keep } of cleanupDirs) {
      const files = (await readdir(dir))
        .filter(f => pattern.test(f))
        .map(f => ({ name: f, path: path.join(dir, f) }));

      // Get file stats and sort by date
      for (const file of files) {
        file.stat = await stat(file.path);
      }
      files.sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

      // Delete older files only if we have a limit
      if (keep !== Infinity) {
        for (const file of files.slice(keep)) {
          await unlink(file.path);
        }
      }
    }

    // Calculate total backup size
    let totalSize = 0;
    const backupFiles = await readdir(backupDir, { recursive: true });
    for (const file of backupFiles) {
      const filePath = path.join(backupDir, file);
      if ((await stat(filePath)).isFile()) {
        totalSize += (await stat(filePath)).size;
      }
    }

    const nextBackup = new Date(Date.now() + 12 * 60 * 60 * 1000).toLocaleString();
    const successMsg = `✅ **Backup completed successfully!**\n\n${sizeReport}\n**💾 Total Backup Size:** ${await formatBytes(totalSize)}\n\n**⏰ Next backup scheduled for:** ${nextBackup}`;
    
    if (channel) {
      await channel.send(successMsg);
    }
    console.log(successMsg);
    return true;

  } catch (error) {
    const errorMsg = `❌ **Error creating backup:** ${error.message}\n\`\`\`${error.stack || 'No stack trace available'}\`\`\``;
    if (channel) {
      await channel.send(errorMsg);
    }
    console.error(errorMsg);
    return false;
  }
}

// If script is run directly, create a backup
if (require.main === module) {
  createBackup().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Backup failed:', err);
    process.exit(1);
  });
}

module.exports = { createBackup }; 