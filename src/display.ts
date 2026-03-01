import Table from "cli-table3";

type ProfileRow = {
  name: string;
  provider: string;
  isDefault: boolean;
};

export function printProfilesTable(rows: ProfileRow[]): void {
  if (rows.length === 0) {
    process.stdout.write("No profiles configured. Run `nnt profile add`.\n");
    return;
  }

  const table = new Table({
    head: ["Profile", "Provider", "Default"],
  });

  for (const row of rows) {
    table.push([row.name, row.provider, row.isDefault ? "yes" : ""]);
  }

  process.stdout.write(`${table.toString()}\n`);
}

export function printKeyValueTable(
  title: string,
  rows: Array<{ key: string; value: string }>,
): void {
  process.stdout.write(`${title}\n`);

  const table = new Table({
    head: ["Field", "Value"],
  });

  for (const row of rows) {
    table.push([row.key, row.value]);
  }

  process.stdout.write(`${table.toString()}\n`);
}
