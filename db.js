{/*const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "coroa_burguer",
  password: "123456",
  port: 5432,
});

module.exports = pool;*/}



// db.js
const { Pool } = require("pg");

// Usa DATABASE_URL da Render ou fallback local
const connectionString = process.env.DATABASE_URL || 
"postgresql://postgres:123456@localhost:5432/postgres"; //esse banco "coroa_burguer_db" é do Render!, do pc é "coroa_burguer",

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false } // SSL apenas se estiver na Render
    : false
});

module.exports = pool;