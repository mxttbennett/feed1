const { generateChart } = require('../utils/chartUtils');

exports.run = async (client, message, args) => {
  await generateChart(client, message, args, 'weekly');
};

exports.help = {
  name: 'w',
  description: '5x6 weekly chart',
  usage: 'w <page #>'
};
