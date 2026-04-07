// because im stupid
if (!process.env.npm_config_user_agent?.includes("pnpm")) {
  console.error("\nuse pnpm dumbass\n");
  process.exit(1);
}