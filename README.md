# AMR Aineistostudio

Selainpohjainen työkalu, jossa pienyrittäjä syöttää verkkosivunsa osoitteen ja
saa ulos valmiit, Alma Median aineisto-ohjeiden mukaiset mainosaineistot.

**Putki:** URL sisään → brändikortti hyväksyttäväksi → aineistot ulos.

## Käynnistys

```bash
npm install
npx playwright install chromium
cp .env.local.example .env.local   # lisää ANTHROPIC_API_KEY
npm run dev
```

Sovellus käynnistyy osoitteeseen `http://localhost:3000`.

### API-avain

Sovellus **toimii ilman avainta**: brändikortti kootaan silloin suoraan sivun
rakenteesta (og-tagit, CSS-muuttujat, logo-heuristiikat) ja tekstit
valmiista pohjista. Koko putki, validointi ja zip-lataus toimivat.

Avain lisää laadun: Claude tunnistaa oikean brändivärin väriehdokkaista,
valitsee mainoskäyttöön sopivat kuvat, tiivistää ydinviestin ja kirjoittaa
copyt tavoitteen mukaan. Lisää se tiedostoon `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6   # valinnainen, oletus
```

Malli on vaihdettavissa. `claude-opus-5` tuottaa selvästi paremman copyn ja
brändianalyysin, jos laatu on tärkeämpää kuin nopeus.

## Arkkitehtuuri

Yksi Next.js-sovellus (App Router), ei erillistä backendia.

```
/app
  /api/extract    scrape + brändianalyysi  → brändikortti-JSON
  /api/generate   copy + template-render   → aineistot + validointi
  /api/validate   yksittäisen aineiston spec-tarkistus (+ GET = speksit)
  /api/zip        aineistot zip-paketiksi + LUEMINUT.txt
  page.tsx        koko käyttöliittymä (syöttö → brändikortti → tulokset)
/lib
  /specs          AMR-tuotespeksit JSON:ina + lukurajapinta
  /templates      HTML/CSS-bannertemplate, muuttujina brändi + copy
  scrape.ts       fetch + cheerio, Playwright-fallback JS-raskaille sivuille
  claude.ts       brändianalyysi + copy-generointi, mock-fallback ilman avainta
  render.ts       Playwright → PNG/JPEG, jaettu selaininstanssi
  validate.ts     puhdas Node-validointi speksejä vasten
  generate.ts     orkestrointi: kuvat → copy → render → validointi
```

### Design system

Käyttöliittymä noudattaa AMR Design Systemiä (claude.ai/design, projekti
"AMR Design System"). Tokenit on kopioitu lähteestä tiedostoon
[globals.css](app/globals.css):

- **Värit** — violetti `#9F248F` ja vihreä `#28B78F` tasavertaisina
  pääväreinä, oliivi `#C2C83D` vain pienenä korostuksena. Sävytetyt
  neutraalit: paperi `#FAF6F8`, muste `#1C0A19`.
- **Typografia** — Archivo, ladataan `next/font/google`-optimoinnilla.
  Painoista käytössä 800 (otsikot, painikkeet, labelit) ja 400
  (leipäteksti); design system sallii sommitelmaan enintään kaksi.
- **Muodot** — 8 pikselin ruudukko, pillinmuotoiset painikkeet
  (`radius: 999px`), korttien 16 px pyöristys, 7 px signature-väripalkki.
- **Moodi** — A (Editorial Light). Työkalu on lomakepainotteinen, joten
  vaalea paperipohja lukee paremmin kuin Mode B:n täyskylläinen violetti,
  ja mainosten esikatselut istuvat neutraalille pohjalle luontevammin.

Design systemissä ei ole tokenia virhevärille — paletti on violetti,
vihreä ja oliivi. Validoinnin tilat on siksi ratkaistu paletin sisällä:
**vihreä = hyväksytty**, **violetti = vaatii huomiota**. Oliivia ei
käytetä tekstiin, koska design system kieltää sen kaikilla pohjilla.

**Mainosaineistoja design system ei koske.** Ne kantavat asiakkaan
brändiä, eivät Alman: kampaamon banneri käyttää kampaamon värejä ja
logoa. [banner.ts](lib/templates/banner.ts) on siksi jätetty ennalleen.

### Speksikirjasto

`lib/specs/display.json` on **ainoa** paikka, jossa mitat, painorajat ja
tekstirajat elävät. Kaikki generointi ja validointi lukee sitä; kovakoodattuja
arvoja ei ole muualla.

Mitat ja maksimipainot ovat Alman virallisia arvoja
([aineisto-ohjeet](https://www.almamedia.fi/mainostajat/aineisto-ohjeet/display-mainonnan-aineisto-ohjeet/),
haettu 2026-08-11). **Tekstirajat ovat tämän työkalun omia**, luettavuuteen
perustuvia rajoja — Alma määrittelee merkkirajat vain Performance Native
-formaatille.

Demossa käytössä olevat kolme ensisijaista kokoa (`"primary": true`):

| Formaatti | Koko | Max |
|---|---|---|
| Paraati | 980×400 | 300 kt |
| Pystyparaati | 300×600 | 300 kt |
| Performance Display | 600×600 | 300 kt |

Kirjastossa on lisäksi Mobiiliparaati, Boksi, Megaparaati ja Tapetti valmiina —
uuden koon saa mukaan vaihtamalla `primary`-lipun päälle.

### Bannerin kaksi moodia

Moodit tulevat AMR Design Systemistä ja valitaan automaattisesti sen mukaan,
onko käyttökelpoinen kuva olemassa:

| Moodi | Milloin | Ilme |
|---|---|---|
| Editorial Light | Kuva löytyi | Vaalea pohja, kuva kantaa ilmeen |
| Bold | Ei kuvaa | Brändiväri koko pohjana, vastavärinen teksti ja CTA |

Värillinen pohja ei ole makuasia: julkaisijan sivu on itsekin valkoinen, joten
valkoinen banneri sulautuu siihen. Ilman kuvaa myös tyhjä pinta jäisi suureksi,
joten typografia kasvaa samalla.

Pohjaväri valitaan brändin väreistä ensimmäinen, joka on riittävän kylläinen
ja tarpeeksi tumma kantamaan luettavaa tekstiä. Lähes valkoinen "brändiväri"
on yleensä poimintavirhe, eikä siitä tehdä pohjaa.

### Copyn tarkistus

Tulosnäkymässä tekstit ovat muokattavissa, ja merkkilaskuri näyttää tiukimman
koon rajan. Muokkaus renderöi aineistot uudelleen **ilman Claude-kutsua**, eli
noin sekunnissa: [generate.ts](lib/generate.ts) käyttää annettuja tekstejä
sellaisenaan, kun `copyVariants` tulee pyynnön mukana.

## Miten laatu varmistetaan

- **Painoraja**: render kokeilee ensin PNG:tä; jos se ylittää rajan, siirtyy
  JPEGiin ja laskee laatua kunnes mahtuu. Lähdekuva pakataan erikseen
  bannerin kokoon, jotta HTML5-paketti pysyy rajan alla.
- **Merkkirajat**: copy generoidaan valittujen kokojen **tiukimpiin** rajoihin,
  joten sama teksti mahtuu jokaiseen kokoon.
- **Tekstin sovitus**: merkkiraja on arvio, koska sama merkkimäärä taittuu eri
  tavalla eri kokoihin ja suomen yhdyssanat vaihtelevat pituudeltaan rajusti.
  Siksi typografia joustaa: renderöinnissä otsikon kokoa pienennetään kunnes
  teksti mahtuu laatikkoon sekä pysty- että vaakasuunnassa. Ilman tätä yhden
  merkin ylitys pudotti kokonaisen sanan katkaisussa, ja yksi pitkä yhdyssana
  saattoi leikkautua reunasta.
- **AI Act -merkintä on pois päältä.** Linjaus on AMR:n: kuvia ei muokata vaan
  ainoastaan rajataan, ja tekstit käyvät läpi ihmisen tarkistuksen ennen
  latausta. Merkintä on toteutettu lippuna eikä poistettu koodista: kun
  `requireAiActLabel` asetetaan takaisin arvoon `true` tiedostossa
  [display.json](lib/specs/display.json), merkintä palaa sekä aineistoihin,
  validointiin että zip-paketin LUEMINUT-tiedostoon.

  Huomaa arviointia varten, että mainosten otsikot, leipätekstit ja CTA:t ovat
  kokonaan mallin kirjoittamia — merkintävelvollisuus koskisi todennäköisimmin
  juuri tekstiä, ei rajattuja kuvia.
- **HTML5**: tiedostot ovat itsenäisiä (kuvat ja tyylit upotettuina), eivät
  lataa mitään ulkopuolelta, eivät käytä jQueryä. Validointi tarkistaa nämä.
- **Kuvavalinta**: kuvaehdokkaat lähetetään mallille kuvina, ei pelkkinä
  URL-osoitteina, jotta se näkee mitä valitsee. Valmiit mainokset hylätään:
  niissä on oma otsikko, oma CTA ja usein eri verkko-osoite, ja rajaus
  katkaisee tekstin kesken. Ennen mallia ajetaan ilmainen suodatin, joka
  pudottaa `/ad/`-polun ja tiedostonimet, joissa on banner, mainos tai promo.
  Jos yksikään kuva ei kelpaa, mainos rakentuu typografialla — se on parempi
  kuin väärä kuva.
- **Kontrasti**: jokaisesta aineistosta mitataan tekstin kontrasti pohjaa
  vasten (vaatimus 4,5:1) ja se, erottuuko CTA pohjasta ja kantaako se itse
  luettavan tekstin. Värit ratkaistaan samalla funktiolla, jolla ne
  renderöidään, joten tarkistus mittaa juuri sitä mikä aineistoon päätyy.
- **Merkistö**: malli sekoittaa satunnaisesti kyrillisiä homoglyyfejä
  latinalaisten sekaan (`lempipiццasi`). Ne näyttävät vilkaisulla oikealta,
  mutta ovat rikkinäistä suomea. Generointi suodattaa tällaiset variaatiot ja
  pyytää uudet; lisäksi jokainen aineisto saa erillisen merkistötarkistuksen,
  joka tekee mahdollisen lipsahduksen näkyväksi.
- **Logon näkyvyys**: sivustoilla on usein negaversio logosta
  (`alma-logo-white.png`), joka latautuu moitteettomasti mutta katoaa vaalealle
  pohjalle. Logon pikselit mitataan ja kontrasti lasketaan taustaväriä vasten;
  jos logo ei erotu, tilalle tulee yrityksen nimi tekstinä ja käyttäjä saa
  varoituksen. Pelkkä latauksen onnistuminen ei siis riitä tarkistukseksi.

## Käyttäjäpolku

Kolme vaihetta: syöttö → brändikortti → aineistot. Polussa pääsee liikkumaan
molempiin suuntiin tietoja menettämättä:

- **Takaisin** vaihtaa vain näkymää. Osoite ja analyysi säilyvät, ja
  ykkösvaiheeseen ilmestyy **Jatka brändikorttiin**, jolla pääsee eteenpäin
  ilman uutta ~14 sekunnin analyysia. Vain **Aloita alusta** tyhjentää kaiken.
- **Pääkuva** valitaan brändikortissa suoraan: aineistoissa käytetään
  ensimmäistä valittuna olevaa kuvaa, ja *Aseta pääkuvaksi* nostaa halutun
  kärkeen. Aiemmin ainoa keino oli poistaa kaikki sitä edeltävät kuvat.
- **Odotusviestit** kertovat mitä putki tekee ("Haetaan verkkosivua…",
  "Sovitetaan kuvat kokoihin…"). Viestit seuraavat todellista
  suoritusjärjestystä; prosentteja ei näytetä, koska palvelin ei raportoi
  edistymää.
- **Zip-paketin sisältö** on valittavissa. Oletuksena mukaan tulee vain
  valittu variaatio, jotta vastaanottajan ei tarvitse arvata mikä kolmesta
  versiosta oli oikea. Kaikki variaatiot saa mukaan A/B-testausta varten.
- **Polun päässä** on toimituskortti. Toimitusta ei ole kytketty, ja se
  sanotaan käyttäjälle suoraan — placeholder ei teeskentele toimivaa.

## Tiedetyt rajoitukset

- **Video on rakentamatta.** Speksit ovat kirjastossa (`video`-lohko) ja
  `ENABLE_VIDEO`-lippu varattu, mutta `/api/video`-reittiä ei ole.
- **Kuvavalinta ilman API-avainta** ottaa ensimmäiset sivulta löytyvät kuvat.
  Nimeen ja polkuun perustuva suodatin karsii ilmeisimmät mainokset, mutta
  kuvien katselu vaatii mallin. Käyttäjä pudottaa huonon kuvan brändikortissa.
- **Kirjoitusvirheitä ei tunnisteta koneellisesti.** Merkistötarkistus nappaa
  kyrilliset lipsahdukset, mutta tavallinen kirjoitusvirhe menee läpi —
  testeissä malli kirjoitti kerran `lempipiazzasi` (pitäisi olla
  `lempipizzasi`). Siksi tekstit ovat muokattavissa tulosnäkymässä; lue ne
  läpi ennen latausta.
- **Fontit** mapataan järjestelmäfontteihin, koska Alma laskee ulkoiset
  fonttilataukset tiedostokokorajaan. Brändifontin nimi näkyy brändikortissa,
  mutta renderöinti käyttää lähintä järjestelmävastinetta.
- **npm audit** raportoi 3 haavoittuvuutta, jotka tulevat Next 15:n
  transitiivisista riippuvuuksista (postcss, sharp). Korjaus vaatii Next 16
  -päivityksen. Ei vaikuta demon ajopolkuun.

## Testattu

Putki on ajettu läpi kolmella oikealla sivustolla ilman API-avainta:

| Sivusto | Poiminta | Aineistot | Validointi |
|---|---|---|---|
| almamedia.fi | 0,7 s | 12 kpl | 12/12 |
| kotipizza.fi | 3,7 s (Playwright) | 12 kpl | 12/12 |
| fazer.fi | 2,1 s (Playwright) | 12 kpl | 12/12 |

Aineistoja syntyy 12: kolme kokoa × kolme copy-variaatiota, sekä
HTML5-animaatio kustakin variaatiosta.

Claude-avaimen kanssa poiminta kestää noin 9 sekuntia ja generointi noin
16 sekuntia, eli koko putki alle puoli minuuttia. Ilman avainta se on alle
10 sekuntia, mutta copy tulee valmiista pohjista.
