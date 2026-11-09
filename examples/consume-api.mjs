const response = await fetch('http://127.0.0.1:8787/events?limit=10');
if (!response.ok) throw new Error(await response.text());
const body = await response.json();
console.log(`events=${body.events.length} incomplete=${body.incomplete}`);
