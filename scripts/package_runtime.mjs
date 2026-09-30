// Deterministic ZIP_STORED archive. Fixed metadata keeps CI and local hashes equal.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entries = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else
      entries.push([relative(root, p).replaceAll("\\", "/"), readFileSync(p)]);
  }
}
walk(join(root, "skills"));
for (const name of ["cli.cjs", "context.cjs", "runtime.cjs"])
  entries.push(["cli/" + name, readFileSync(join(root, "dist", name))]);
entries.push([
  "validation.cjs",
  readFileSync(join(root, "dist/validation.cjs")),
]);
entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const files = [],
  central = [];
let offset = 0;
for (const [name, data] of entries) {
  const n = Buffer.from(name),
    checksum = crc(data),
    header = Buffer.alloc(30),
    directory = Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(0x5021, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(n.length, 26);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(0x314, 4);
  header.copy(directory, 6, 4, 30);
  directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  directory.writeUInt32LE(offset, 42);
  files.push(header, n, data);
  central.push(directory, n);
  offset += header.length + n.length + data.length;
}
const index = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(index.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(
  join(root, "dist/runtime.zip"),
  Buffer.concat([...files, index, end]),
);
