# Tide
- [x] Priorità dinamiche, scadenze anti-ansia e previsione del carico (Centro Priorità 1–100 con badge e barra pulsante; banner con rischio ritardi e materie fragili dai voti reali).
- [x] Recupero e time boxing collegati alle attività con storico locale (preset 25/50/90 min, recupero domani o split; progressi accreditati solo a timer scaduto).
- [x] Diario, link per materia e routine giornaliere (chiave localStorage separata; link accettati solo http/https).
- [x] Report settimanale, ROI e PDF; verificati flussi e conservazione dati (Scatter ore/voti, export PDF client-side, solo sessioni della settimana).
- [x] Separare Scuola/Vita conservando i dati e filtrando dashboard, bacheca e grafici.
- [x] Aggiungere scadenze opzionali e notifiche native locali consensuali.
- [x] Verificare migrazione, separazione, promemoria e flusso nell'app (API nativa simulata; banner macOS non verificabile dal browser di test).
- [x] Import da screenshot: OCR locale gratuito (Tesseract in WebAssembly) per i voti di Nuvola e per i compiti di Classroom/lavagna, con priorità e blocchi di Time Boxing stimati; verificato end-to-end in browser con screenshot di prova.
- [x] Import voti sicuro: preprocessing locale dell'immagine, confidenza per campo, revisione con approva/modifica/rifiuta, doppioni, undo dello storico e auto-approvazione opt-in (default off). CSV/Excel da Nuvola resta la via consigliata; nessun voto viene salvato senza conferma.