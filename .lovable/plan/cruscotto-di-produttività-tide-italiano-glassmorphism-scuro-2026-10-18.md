# Cruscotto di produttività "Tide" (italiano, glassmorphism scuro)

## Cosa costruisco
App interamente in italiano, sfondo scuro con sfumature morbide, card in vetro satinato, barra laterale sinistra con 4 schermate. Tutti i dati salvati automaticamente nel browser (localStorage).

## Schermate
1. **Dashboard** (`/`)
   - "Buon mattino, Lin" + data odierna in italiano.
   - "Oggi": 3 anelli interattivi (Compiti x/y dai task spuntati, Ore di Focus dal timer, Riunioni x/y cliccabili).
   - "Prossimi impegni": lista eventi con orari relativi ("In 20 min", ecc.).
   - "Focus": Pomodoro 25:00 reale con Avvia / Pausa / +5 min / reset; badge fluttuante con countdown quando attivo (visibile su tutte le schermate); minuti completati sommano alle ore di focus.
   - "I miei compiti": checkbox con testo barrato, aggiunta rapida, aggiorna gli anelli.
2. **Bacheca** (`/bacheca`): colonne In corso / In revisione / Completato, drag and drop nativo + selettore rapido di stato su ogni scheda; titolo, progetto, badge priorità (Urgente rosso, Alta arancione, Media giallo, Bassa verde); "+ Nuovo Task" con dialog; eliminazione.
3. **Analisi** (`/analisi`): grafico lineare "Throughput" (task completati per giorno, ultimi 7 giorni) e grafico a torta "Per Progetto" con % completati, con recharts.
4. **Impostazioni** (`/impostazioni`): griglia sfondi Ash, Sand, Sage, Aurora, Smoke, Tide, Bloom, Ember, Grove, Dusk (cambio immediato); accenti Rosa, Rosso, Arancione, Verde, Blu.

## Dettagli tecnici
- Store unico (React context + reducer) persistito in localStorage, letto in useEffect per evitare mismatch SSR; dati demo iniziali in italiano.
- Timer basato su timestamp di fine, così sopravvive al refresh.
- Sfondi come gradienti CSS e accento come variabile `--primary` impostati su `<html>` tramite data-attribute; token in styles.css, utility `glass` (backdrop-blur-lg, bg 3% bianco, bordo 8%).
- Font: Manrope/Sora via link nel root. Route separate con head() in italiano.
- Dipendenze: lucide-react, recharts.
