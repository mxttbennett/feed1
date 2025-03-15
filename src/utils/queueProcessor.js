const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds base delay
const QUEUE_CHECK_DELAY = 300000; // 5 minutes
const PROCESS_DELAY = 10000; // 10 seconds between items
const ERROR_LOGS_CHANNEL = '1350524158915776604';

async function processQueue({
    queueModel,
    processItem,
    logToChannel,
    itemType = 'item',
    client // Add client parameter to access Discord channels
}) {
    // Helper function to log errors to both console and Discord channel
    async function logError(error, context = '') {
        console.error(error);
        
        try {
            const errorChannel = await client.channels.fetch(ERROR_LOGS_CHANNEL);
            if (!errorChannel) {
                console.error('Could not find error logs channel');
                return;
            }

            let errorMsg = '';
            if (error.statusCode) {
                // Format Last.fm API errors
                const errorDetails = {
                    8: "Backend operation failed - Last.fm's servers may be having issues",
                    29: "Rate limit exceeded - Too many requests to Last.fm API",
                    11: "Service offline - Last.fm API is temporarily down",
                    16: "Temporary error - Last.fm API request failed",
                    400: "Bad Request - Check API parameters"
                };

                const errorDescription = errorDetails[error.statusCode] || `Unknown error code ${error.statusCode}`;
                errorMsg = `🚨 **Last.fm API Error**\n` +
                    `**Status Code:** ${error.statusCode}\n` +
                    `**Description:** ${errorDescription}\n` +
                    `**Message:** ${error.message}\n` +
                    `**Endpoint:** ${error.endpoint || 'N/A'}\n` +
                    (error.response ? `**Response:** \`\`\`json\n${error.response.substring(0, 1000)}${error.response.length > 1000 ? '...' : ''}\n\`\`\`\n` : '') +
                    `**Context:** ${context}`;
            } else if (error.name === 'SequelizeValidationError') {
                // Format Sequelize validation errors
                const validationErrors = error.errors.map(err => 
                    `- ${err.path}: ${err.message}`
                ).join('\n').substring(0, 1000);
                
                errorMsg = `🚨 **Database Validation Error**\n` +
                    `**Type:** ${error.name}\n` +
                    `**Errors:**\n${validationErrors}${error.errors.length > 1000 ? '...' : ''}\n` +
                    `**Context:** ${context}`;
            } else {
                // Format general errors
                errorMsg = `🚨 **Error**\n` +
                    `**Type:** ${error.name || 'Unknown'}\n` +
                    `**Message:** ${error.message}\n` +
                    (error.stack ? `**Stack:** \`\`\`\n${error.stack.substring(0, 1000)}${error.stack.length > 1000 ? '...' : ''}\n\`\`\`\n` : '') +
                    `**Context:** ${context}`;
            }

            // Ensure message doesn't exceed Discord's limit
            if (errorMsg.length > 2000) {
                errorMsg = errorMsg.substring(0, 1997) + '...';
            }

            await errorChannel.send(errorMsg);
        } catch (err) {
            console.error('Failed to send error to Discord channel:', err);
        }
    }

    let lastQueueLength = 0;
    
    while (true) {
        try {
            const items = await queueModel.findAll();
            const itemLength = items.length;

            if (itemLength === 0) {
                await logToChannel(`⏳ Queue is empty. Waiting 5 minutes before checking again...`);
                await sleep(QUEUE_CHECK_DELAY);
                continue;
            }

            // Only log queue status when it changes
            if (itemLength !== lastQueueLength) {
                await logToChannel(`🎵 Processing ${itemLength} ${itemType}s in queue...`);
                lastQueueLength = itemLength;
            }

            let currentItem = items[0];
            if (!currentItem) {
                await logError(new Error(`No ${itemType} found in queue`), 'Queue Processing');
                await sleep(PROCESS_DELAY);
                continue;
            }

            // Try to process with retries
            let success = false;
            let lastError = null;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    // First remove from queue to prevent getting stuck
                    const whereClause = {
                        guildID: currentItem.guildID,
                        ...(itemType === 'album' 
                            ? { 
                                artistName: currentItem.artistName,
                                albumName: currentItem.albumName
                            }
                            : { 
                                artistName: currentItem.artistName 
                            })
                    };

                    await queueModel.destroy({ where: whereClause });

                    // Process the item
                    await processItem(currentItem);
                    success = true;
                    break;

                } catch (error) {
                    lastError = error;
                    await logError(error, `Processing ${itemType} (Attempt ${attempt}/${MAX_RETRIES}): ${JSON.stringify(currentItem)}`);

                    // If it's a rate limit or temporary backend error, retry
                    if (error.statusCode === 8 || error.statusCode === 29 || error.statusCode === 16) {
                        const delay = RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
                        await logToChannel(`⚠️ Last.fm API error, retrying in ${delay/1000}s... (Attempt ${attempt}/${MAX_RETRIES})`);
                        await sleep(delay);
                        continue;
                    }
                    
                    // For other errors, break retry loop
                    break;
                }
            }

            if (!success) {
                // Make sure item is removed from queue if we haven't already
                try {
                    const whereClause = {
                        guildID: currentItem.guildID,
                        ...(itemType === 'album' 
                            ? { 
                                artistName: currentItem.artistName,
                                albumName: currentItem.albumName
                            }
                            : { 
                                artistName: currentItem.artistName 
                            })
                    };

                    const stillExists = await queueModel.findOne({ where: whereClause });
                    
                    if (stillExists) {
                        await queueModel.destroy({ where: whereClause });
                        await logToChannel(`⚠️ Removed problematic ${itemType} from queue after ${MAX_RETRIES} failed attempts`);
                    }
                } catch (err) {
                    await logError(err, `Failed to remove problematic ${itemType} from queue`);
                }
            }

            // Add delay between processing to avoid rate limiting
            await sleep(PROCESS_DELAY);

        } catch (e) {
            await logError(e, 'Queue Processor Main Loop');
            await sleep(PROCESS_DELAY);
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    processQueue
}; 