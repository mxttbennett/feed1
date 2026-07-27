import type { Message, SendableChannels } from 'discord.js';

/** The invoking channel, narrowed to one we can send to (always true for guild text/DM). */
export function sendable(message: Message): SendableChannels {
  if (!message.channel.isSendable()) {
    throw new Error(`channel ${message.channelId} is not sendable`);
  }
  return message.channel;
}
