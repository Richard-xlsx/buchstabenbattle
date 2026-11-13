// Stille Post mit Bildern: Spielregeln ohne Netzwerk und ohne Oberfläche.
// S = kleiner Zustand (wird jede Sekunde an alle geschickt), K = Ketten-Einträge (werden einzeln verschickt).
// Jeder Teilnehmer beginnt eine Kette. In Schritt k arbeitet Teilnehmer i an Kette (i - k) mod n.
// Gerade Schritte: Text (0 = Startsatz, danach Beschreibung des Bildes), ungerade Schritte: Bild malen.
(function () {
  const TEMPO = { entspannt: [60, 120], normal: [40, 80], schnell: [30, 60], test: [15, 15] };
  const MAX_PUNKTE = 4000;            // Zeichenpunkte je Bild (hält Nachrichten klein)
  const kopie = x => JSON.parse(JSON.stringify(x));
  const key = (c, k) => c + ":" + k;
  const typVon = k => (k % 2 === 0 ? "text" : "bild");

  function neu(code, hostPid, hostName, einst) {
    return {
      v: 1, spiel: "stillepost", code, epoch: 0, host: hostPid, phase: "lobby",
      tempo: (einst && TEMPO[einst.tempo]) ? einst.tempo : "normal",
      spieler: { [hostPid]: { name: hostName } }, reihenfolge: [hostPid],
      teilnehmer: [], schritt: 0, schritte: 0, rest: null, abgegeben: [], show: null, herzen: {}, aenderung: Date.now()
    };
  }
  const zeit = (S, k) => TEMPO[S.tempo][typVon(k) === "text" ? 0 : 1];

  function aufgabe(S, pid) {
    const n = S.teilnehmer.length, i = S.teilnehmer.indexOf(pid);
    if (i < 0 || S.phase !== "runde") return null;
    const c = (i - S.schritt + n * 10) % n;
    return { kette: c, schritt: S.schritt, typ: typVon(S.schritt), vorher: S.schritt > 0 ? key(c, S.schritt - 1) : null, key: key(c, S.schritt) };
  }

  function bereinigen(typ, inhalt) {
    if (typ === "text") return { typ, text: String((inhalt && inhalt.text) || "").trim().slice(0, 120) };
    const striche = [];
    let punkte = 0;
    for (const s of ((inhalt && inhalt.striche) || []).slice(0, 400)) {
      const p = (s.p || []).slice(0, 2 * (MAX_PUNKTE - punkte)).map(v => Math.max(0, Math.min(1000, Math.round(+v || 0))));
      if (p.length < 2) continue;
      punkte += p.length / 2;
      striche.push({ f: Math.max(0, Math.min(9, s.f | 0)), d: Math.max(1, Math.min(3, s.d | 0 || 1)), p });
      if (punkte >= MAX_PUNKTE) break;
    }
    return { typ, striche };
  }

  function naechsterSchritt(S, K, neuKeys) {
    for (const p of S.teilnehmer) {
      if (S.abgegeben.includes(p)) continue;
      const a = aufgabe(S, p);
      K[a.key] = { von: p, typ: a.typ, leer: true };
      neuKeys.push(a.key);
    }
    S.schritt += 1;
    if (S.schritt >= S.schritte) { S.phase = "show"; S.rest = null; S.show = { kette: 0, eintrag: 0 }; }
    else { S.rest = zeit(S, S.schritt); S.abgegeben = []; }
  }

  // Aktion anwenden: gibt {S, K, neu} zurück (neu = neu entstandene Ketten-Einträge).
  function aktion(S0, K0, pid, m) {
    const S = kopie(S0), K = Object.assign({}, K0), neuKeys = [];
    const istHost = pid === S.host;
    const unveraendert = { S: S0, K: K0, neu: [] };
    switch (m.t) {
      case "hallo": case "join": {
        const name = String(m.name || "").trim().slice(0, 20) || "Gast";
        if (!S.spieler[pid]) { S.spieler[pid] = { name }; S.reihenfolge.push(pid); } else S.spieler[pid].name = name;
        if (m.t === "hallo" && m.letzte && S.phase === "runde" && m.letzte.schritt === S.schritt && !S.abgegeben.includes(pid)) {
          const r = aktion(S, K, pid, { t: "abgabe", schritt: m.letzte.schritt, inhalt: m.letzte.inhalt });
          return { S: r.S, K: r.K, neu: r.neu };
        }
        break;
      }
      case "einstellungen":
        if (!istHost || S.phase !== "lobby" || !TEMPO[m.tempo]) return unveraendert;
        S.tempo = m.tempo; break;
      case "start": {
        if (!istHost || !(S.phase === "lobby" || S.phase === "ende")) return unveraendert;
        const t = (m.teilnehmer || S.reihenfolge).filter(p => S.spieler[p]);
        if (t.length < 3) return unveraendert;
        Object.assign(S, { teilnehmer: t, schritt: 0, schritte: t.length, phase: "runde", abgegeben: [], show: null, herzen: {}, spielNr: (S.spielNr || 0) + 1 });
        S.rest = zeit(S, 0);
        for (const k in K) delete K[k];
        break;
      }
      case "abgabe": {
        if (S.phase !== "runde" || m.schritt !== S.schritt || S.abgegeben.includes(pid)) return unveraendert;
        const a = aufgabe(S, pid); if (!a) return unveraendert;
        const e = bereinigen(a.typ, m.inhalt);
        K[a.key] = Object.assign({ von: pid }, e, (a.typ === "text" ? !e.text : !e.striche.length) ? { leer: true } : {});
        neuKeys.push(a.key);
        S.abgegeben.push(pid);
        if (S.abgegeben.length >= S.teilnehmer.length) naechsterSchritt(S, K, neuKeys);
        break;
      }
      case "herz": {
        if (!(S.phase === "show" || S.phase === "ende") || !K[m.key] || K[m.key].von === pid || K[m.key].leer) return unveraendert;
        const l = S.herzen[m.key] || [];
        S.herzen[m.key] = l.includes(pid) ? l.filter(x => x !== pid) : l.concat(pid);
        break;
      }
      case "zeigen": {                     // Diashow: Spielleiter blättert vor oder zurück
        if (!istHost || S.phase !== "show") return unveraendert;
        let { kette, eintrag } = S.show;
        if (m.richtung > 0) { if (eintrag < S.schritte - 1) eintrag++; else if (kette < S.teilnehmer.length - 1) { kette++; eintrag = 0; } else { S.phase = "ende"; } }
        else { if (eintrag > 0) eintrag--; else if (kette > 0) { kette--; eintrag = S.schritte - 1; } }
        S.show = { kette, eintrag };
        break;
      }
      case "neustart":
        if (!istHost) return unveraendert;
        Object.assign(S, { phase: "lobby", teilnehmer: [], schritt: 0, schritte: 0, rest: null, abgegeben: [], show: null, herzen: {}, spielNr: (S.spielNr || 0) + 1 });
        for (const k in K) delete K[k];
        break;
      default: return unveraendert;
    }
    S.aenderung = Date.now();
    return { S, K, neu: neuKeys };
  }

  function tick(S0, K0) {
    if (S0.phase !== "runde") return { S: S0, K: K0, neu: [] };
    const S = kopie(S0), K = Object.assign({}, K0), neuKeys = [];
    S.rest = Math.max(0, (S.rest || 0) - 1);
    if (S.rest === 0) { naechsterSchritt(S, K, neuKeys); S.aenderung = Date.now(); }
    return { S, K, neu: neuKeys };
  }

  function herzenJeSpieler(S, K) {
    const z = {};
    for (const k in S.herzen) { const e = K[k]; if (e) z[e.von] = (z[e.von] || 0) + S.herzen[k].length; }
    return z;
  }

  window.SP = { TEMPO, MAX_PUNKTE, key, typVon, neu, aufgabe, aktion, tick, herzenJeSpieler, bereinigen };
})();
