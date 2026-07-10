// Fetch the live Quickstart example from the deployed service so public/skill.md
// can show byte-exact response bytes. Usage:
//   node scripts/refresh-skill-example.mjs [base-url]
// Default base URL: https://ringguard.vercel.app
const base = process.argv[2] ?? "https://ringguard.vercel.app";

const quickstart = {
  records: [
    { reviewer: "alice", subject: "bob" },
    { reviewer: "bob", subject: "carol" },
    { reviewer: "carol", subject: "alice" },
    { reviewer: "ring_a", subject: "ring_b" },
    { reviewer: "ring_b", subject: "ring_a" },
    { reviewer: "ring_a", subject: "ring_c" },
    { reviewer: "ring_c", subject: "ring_a" },
    { reviewer: "ring_b", subject: "ring_c" },
    { reviewer: "ring_c", subject: "ring_b" },
  ],
};

const res = await fetch(`${base}/v1/audit`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(quickstart),
});
console.log(`# ${res.status} ${base}/v1/audit — paste into public/skill.md Quickstart:\n`);
console.log(await res.text());
