// Database initialization script
const { initSqlJsDatabase, initializeDatabase } = require('./database');

async function main() {
  console.log('Initializing database...');

  try {
    await initSqlJsDatabase();
    console.log('Database connection established');

    initializeDatabase();
    console.log('Database schema and seed data initialized successfully!');

    process.exit(0);
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

main();
