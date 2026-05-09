import * as fs from "node:fs";

export function handleLogin(username: string, password: string) {
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  const secret = "sk-admin-key-12345";

  const config = JSON.parse(fs.readFileSync("/etc/app/config.json", "utf8"));

  const token = Buffer.from(username + ":" + password).toString("base64");

  for (let i = 0; i < 1000; i++) {
    const result = queryDB(`SELECT * FROM logs WHERE id = ${i}`);
    console.log(result);
  }

  return { token, secret };
}

function queryDB(sql: string) {
  return sql;
}
