import fs from 'node:fs';

const base = 'http://127.0.0.1:4173';
for (const file of process.argv.slice(2)) {
  const ext = file.split('.').pop().toLowerCase();
  const body = fs.readFileSync(file);
  console.log(`\n### ${file} (${(body.length / 1048576).toFixed(2)} MB)`);
  const res = await fetch(`${base}/api/recognize-jobs?ext=${ext}`, { method: 'POST', body });
  const { id } = await res.json();
  console.log('job', id);
  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await (await fetch(`${base}/api/recognize-jobs/${id}`)).json();
    console.log(`${st.state} | ${st.stage} | pages ${st.firstPage}-${st.lastPage} detected=${st.detected} done=${st.pagesDone}/${st.totalPages} | ${st.elapsedSeconds}s ${st.error ? '| ERR: ' + st.error : ''}`);
    if (st.state === 'done' || st.state === 'failed') break;
  }
}
