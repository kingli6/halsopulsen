const { Pool } = require("pg");

async function createRollbackTestDatabase() {
  const connectionString = process.env.WORKOUTPLANNER_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "WORKOUTPLANNER_TEST_DATABASE_URL is required; refusing any shared or default database."
    );
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10000
  });
  let transactionClient;
  try {
    transactionClient = await pool.connect();
    await transactionClient.query("BEGIN");
  } catch (error) {
    transactionClient?.release();
    await pool.end();
    throw error;
  }

  let savepointNumber = 0;
  const database = {
    query: (sql, values) => transactionClient.query(sql, values),
    async connect() {
      let savepoint = null;
      return {
        async query(sql, values) {
          const command = String(sql).trim().replace(/;$/, "").toLowerCase();
          if (command === "begin") {
            if (savepoint) throw new Error("A nested service transaction is already open.");
            savepoint = `workoutplanner_test_${++savepointNumber}`;
            return transactionClient.query(`SAVEPOINT ${savepoint}`);
          }
          if (command === "commit") {
            if (!savepoint) throw new Error("No nested service transaction is open.");
            const current = savepoint;
            savepoint = null;
            return transactionClient.query(`RELEASE SAVEPOINT ${current}`);
          }
          if (command === "rollback") {
            if (!savepoint) return { command: "ROLLBACK", rows: [], rowCount: 0 };
            const current = savepoint;
            savepoint = null;
            await transactionClient.query(`ROLLBACK TO SAVEPOINT ${current}`);
            return transactionClient.query(`RELEASE SAVEPOINT ${current}`);
          }
          return transactionClient.query(sql, values);
        },
        release() {}
      };
    }
  };

  let closed = false;
  return {
    database,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await transactionClient.query("ROLLBACK");
      } finally {
        transactionClient.release();
        await pool.end();
      }
    }
  };
}

module.exports = { createRollbackTestDatabase };
