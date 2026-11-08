# Relazioni, dal PDF al testo

Sito per trasformare relazioni mediche scansionate (PDF) in testo modificabile e in Word.
Tutto avviene nel browser: i documenti non vengono mai inviati a un server.

Indirizzo: https://relazionipdf2testo.github.io/

## Come funziona

1. **Carica**: il PDF viene aperto con PDF.js. Ogni pagina viene raddrizzata (profilo di proiezione) e vengono proposte in automatico le zone da non leggere (loghi, timbri, firme).
2. **Controlla le pagine**: con lo strumento *Copri* si escludono altre parti; con *Tabella* si segnalano le tabelle e si sistemano le linee delle colonne.
3. **Testo pronto**: OCR con Tesseract.js (modello italiano incluso nel sito). Il documento e il testo scorrono insieme; le parole incerte, soprattutto i numeri, sono evidenziate in giallo. Il testo si può copiare o scaricare in Word.

I documenti restano nell'archivio del browser (IndexedDB) e si cancellano da soli 30 giorni dopo l'ultima apertura.

## Sviluppo

```bash
npm install
npm run dev      # sito in locale
npm run build    # versione da pubblicare in dist/
```

La pubblicazione su GitHub Pages è automatica a ogni push su `main` (vedi `.github/workflows/deploy.yml`).
Nella repository non vanno mai messi PDF o documenti veri: il `.gitignore` li esclude.
