// Spiellogik ohne Netzwerk und ohne Oberfläche. Der Spielleiter hält den Zustand und wendet Aktionen an.
(function () {
  const KATEGORIEN = ["Song", "Promi", "Film", "Ausrede fürs Zuspätkommen", "Was man um 3 Uhr nachts googelt"];
  const BUCHSTABEN = "ABDEFGHIJKLMNOPRSTUVWZ".split("");   // ohne C, Q, X, Y
  const STOPP_SEKUNDEN = 10;

  function neu(code, hostPid, hostName, einst) {
    einst = einst || {};
    return {
      v: 1, code, epoch: 0, host: hostPid, phase: "lobby",
      runde: 0, runden: einst.runden || 5, rundenzeit: einst.rundenzeit || 180,
      kategorien: KATEGORIEN.slice(), buchstabe: null, benutzt: [],
      spieler: { [hostPid]: { name: hostName, punkte: 0 } }, reihenfolge: [hostPid],
      antworten: {}, stopp: null, rest: null, bewertung: {}, ergebnis: null, aenderung: Date.now()
    };
  }

  const kopie = s => JSON.parse(JSON.stringify(s));
  const leer = n => Array.from({ length: n }, () => "");

  function buchstabeZiehen(s, zufall) {
    const frei = BUCHSTABEN.filter(b => !s.benutzt.includes(b));
    const pool = frei.length ? frei : BUCHSTABEN;
    return pool[Math.floor((zufall ? zufall() : Math.random()) * pool.length)];
  }

  // Aktion eines Spielers anwenden. Gibt den neuen Zustand zurück (oder den alten, wenn nichts passiert).
  function aktion(s0, pid, m, zufall) {
    const s = kopie(s0);
    const istHost = pid === s.host;
    switch (m.t) {
      case "hallo":
      case "join": {
        const name = String(m.name || "").trim().slice(0, 20) || "Gast";
        if (!s.spieler[pid]) { s.spieler[pid] = { name, punkte: 0 }; s.reihenfolge.push(pid); }
        else s.spieler[pid].name = name;
        if (m.t === "hallo" && m.runde === s.runde && Array.isArray(m.werte) && (s.phase === "spielen" || s.phase === "stopp"))
          s.antworten[pid] = m.werte.slice(0, s.kategorien.length).map(x => String(x || "").slice(0, 80));
        break;
      }
      case "einstellungen":
        if (!istHost || s.phase !== "lobby") return s0;
        if ([3, 5, 8].includes(m.runden)) s.runden = m.runden;
        if ([120, 180, 240].includes(m.rundenzeit)) s.rundenzeit = m.rundenzeit;
        break;
      case "start":
        if (!istHost || !(s.phase === "lobby" || s.phase === "rundenende")) return s0;
        if (s.phase === "rundenende" && s.runde >= s.runden) return s0;
        s.runde += 1; s.phase = "spielen";
        s.buchstabe = buchstabeZiehen(s, zufall); s.benutzt.push(s.buchstabe);
        s.antworten = {}; s.bewertung = {}; s.stopp = null; s.rest = s.rundenzeit; s.ergebnis = null;
        break;
      case "antwort":
        if (!(s.phase === "spielen" || s.phase === "stopp") || m.runde !== s.runde || !s.spieler[pid]) return s0;
        s.antworten[pid] = (m.werte || []).slice(0, s.kategorien.length).map(x => String(x || "").slice(0, 80));
        break;
      case "stopp": {
        if (s.phase !== "spielen" || m.runde !== s.runde) return s0;
        const w = m.werte || s.antworten[pid] || [];
        if (w.length < s.kategorien.length || w.some(x => !String(x || "").trim())) return s0;
        s.antworten[pid] = w.slice(0, s.kategorien.length).map(x => String(x).slice(0, 80));
        s.phase = "stopp"; s.stopp = pid; s.rest = STOPP_SEKUNDEN;
        break;
      }
      case "veto":
      case "herz": {
        if (s.phase !== "bewerten" || m.ziel === pid || !s.spieler[m.ziel] || !(m.k >= 0 && m.k < s.kategorien.length)) return s0;
        const b = s.bewertung;
        if (m.t === "veto") {
          const key = m.ziel + "|" + m.k;
          b.veto = b.veto || {}; const l = b.veto[key] || [];
          b.veto[key] = l.includes(pid) ? l.filter(x => x !== pid) : l.concat(pid);
        } else {
          b.herz = b.herz || {}; const key = pid + "|" + m.k;     // ein Herz pro Kategorie und Spieler
          b.herz[key] = b.herz[key] === m.ziel ? null : m.ziel;
        }
        break;
      }
      case "weiter":
        if (!istHost || s.phase !== "bewerten") return s0;
        s.ergebnis = auswerten(s);
        for (const p in s.ergebnis.summe) if (s.spieler[p]) s.spieler[p].punkte += s.ergebnis.summe[p];
        s.phase = s.runde >= s.runden ? "ende" : "rundenende";
        break;
      case "neustart":
        if (!istHost) return s0;
        for (const p in s.spieler) s.spieler[p].punkte = 0;
        Object.assign(s, { phase: "lobby", runde: 0, benutzt: [], buchstabe: null, antworten: {}, bewertung: {}, stopp: null, rest: null, ergebnis: null });
        break;
      default:
        return s0;
    }
    s.aenderung = Date.now();
    return s;
  }

  // Eine Sekunde Spielzeit (nur der Spielleiter ruft das auf, solange er da ist).
  function tick(s0) {
    if (!(s0.phase === "spielen" || s0.phase === "stopp")) return s0;
    const s = kopie(s0);
    s.rest = Math.max(0, (s.rest || 0) - 1);
    if (s.rest === 0) { s.phase = "bewerten"; s.rest = null; s.bewertung = {}; }
    return s;
  }

  const ohneAkzent = c => ({ "Ä": "A", "Ö": "O", "Ü": "U" }[c] || c);
  function ersterBuchstabe(text) {
    const m = String(text || "").toUpperCase().match(/[A-ZÄÖÜ]/);
    return m ? ohneAkzent(m[0]) : "";
  }
  function norm(text) {
    return String(text || "").toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Punkte: gültig und allein in der Kategorie 20, gültig und einzigartig 10, doppelt 5, sonst 0.
  // Ungültig: leer, falscher Anfangsbuchstabe oder Mehrheit der anderen Spieler dagegen. Lieblingsantwort (meiste Herzen) +5.
  function auswerten(s) {
    const pids = s.reihenfolge.filter(p => s.spieler[p]);
    const andere = Math.max(1, pids.length - 1);
    const veto = (s.bewertung && s.bewertung.veto) || {}, herz = (s.bewertung && s.bewertung.herz) || {};
    const det = {}, summe = {};
    pids.forEach(p => { det[p] = []; summe[p] = 0; });
    s.kategorien.forEach((_, k) => {
      const zeilen = pids.map(p => {
        const text = String(((s.antworten[p] || [])[k]) || "").trim();
        const v = (veto[p + "|" + k] || []).filter(x => x !== p).length;
        let grund = "";
        if (!text) grund = "leer";
        else if (ersterBuchstabe(text) !== s.buchstabe) grund = "falscher Buchstabe";
        else if (v * 2 > andere) grund = "abgelehnt";
        return { p, text, n: norm(text), gueltig: !grund, grund, veto: v };
      });
      const gueltig = zeilen.filter(z => z.gueltig);
      const herzen = {};
      for (const key in herz) { const [von, kk] = key.split("|"); if (+kk === k && herz[key] && von !== herz[key]) herzen[herz[key]] = (herzen[herz[key]] || 0) + 1; }
      const maxHerz = Math.max(0, ...gueltig.map(z => herzen[z.p] || 0));
      zeilen.forEach(z => {
        let pkt = 0, doppelt = false;
        if (z.gueltig) {
          doppelt = gueltig.some(o => o !== z && o.n === z.n);
          pkt = gueltig.length === 1 ? 20 : doppelt ? 5 : 10;
        }
        const h = herzen[z.p] || 0, bonus = z.gueltig && maxHerz > 0 && h === maxHerz ? 5 : 0;
        det[z.p][k] = { text: z.text, gueltig: z.gueltig, grund: z.grund, doppelt, punkte: pkt, herz: h, bonus };
        summe[z.p] += pkt + bonus;
      });
    });
    return { runde: s.runde, buchstabe: s.buchstabe, det, summe };
  }

  window.SLF = { KATEGORIEN, BUCHSTABEN, STOPP_SEKUNDEN, neu, aktion, tick, auswerten, norm, ersterBuchstabe };
})();
