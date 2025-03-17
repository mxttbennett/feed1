'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      UPDATE times 
      SET ms = CAST(ms AS INTEGER)
    `);

    return queryInterface.changeColumn('times', 'ms', {
      type: Sequelize.INTEGER,
      allowNull: false
    });
  },

  async down(queryInterface, Sequelize) {
    return queryInterface.changeColumn('times', 'ms', {
      type: Sequelize.STRING,
      allowNull: false
    });
  }
};
