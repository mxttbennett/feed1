const { generateChart } = require('../utils/chartUtils');

exports.run = async (client, message, args) => {
  await generateChart(client, message, args, 'yearly');
};

exports.help = {
  name: 'y',
  description: '5x10 yearly chart',
  usage: 'y <page #>'
};
