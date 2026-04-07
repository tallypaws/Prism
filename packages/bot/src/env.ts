import fs from "fs";

try {
  const envContent = await fs.promises.readFile("./.env", "utf-8");
  const envLines = envContent.split("\n");
  for (const line of envLines) {
    const [key, value] = line.split("=");
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  }
} catch (error) {}
