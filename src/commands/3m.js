const { generateChart } = require('../utils/chartUtils');

exports.run = async (client, message, args) => {
  await generateChart(client, message, args, 'threeMonth');
};

exports.help = {
  name: '3m',
  description: '5x10 3-month chart',
  usage: '3m <page #>'
};
