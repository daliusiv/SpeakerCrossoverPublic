// Starter driver library. Values are approximate nominal figures taken from public
// manufacturer datasheets and are meant as a starting point — always check the current
// datasheet, and use measured FRD/ZMA files for a real design.
// Fields: fs Hz, re Ω, le mH, qms, qes, vas L, sd cm², sens dB @ 2.83 V / 1 m, xmax mm.

export const LIBRARY = [
  // Woofers / mid-woofers
  { id: 'dayton-rs150-8', brand: 'Dayton Audio', model: 'RS150-8', type: 'woofer', size: '5.5"', fs: 53, re: 5.6, le: 0.34, qms: 3.6, qes: 0.42, vas: 7.4, sd: 85, sens: 86.0, xmax: 5, site: 'https://www.daytonaudio.com/' },
  { id: 'dayton-rs180-8', brand: 'Dayton Audio', model: 'RS180-8', type: 'woofer', size: '7"', fs: 37.4, re: 6.2, le: 0.42, qms: 2.2, qes: 0.46, vas: 20, sd: 133, sens: 86.8, xmax: 7, site: 'https://www.daytonaudio.com/' },
  { id: 'dayton-rs225-8', brand: 'Dayton Audio', model: 'RS225-8', type: 'woofer', size: '8"', fs: 28.6, re: 6.2, le: 0.51, qms: 3.0, qes: 0.41, vas: 45, sd: 220, sens: 87.8, xmax: 7, site: 'https://www.daytonaudio.com/' },
  { id: 'dayton-dc160-8', brand: 'Dayton Audio', model: 'DC160-8', type: 'woofer', size: '6.5"', fs: 47.6, re: 6.4, le: 0.87, qms: 3.7, qes: 0.47, vas: 11.6, sd: 87, sens: 87.0, xmax: 4, site: 'https://www.daytonaudio.com/' },
  { id: 'sb-sb15nrx2c30-8', brand: 'SB Acoustics', model: 'SB15NRX2C30-8', type: 'woofer', size: '5.5"', fs: 43, re: 5.8, le: 0.38, qms: 3.3, qes: 0.44, vas: 11, sd: 82, sens: 86.5, xmax: 5, site: 'https://sbacoustics.com/' },
  { id: 'sb-sb17nrx2c35-8', brand: 'SB Acoustics', model: 'SB17NRX2C35-8', type: 'woofer', size: '6.5"', fs: 37, re: 5.7, le: 0.33, qms: 3.6, qes: 0.37, vas: 22.2, sd: 133, sens: 88.0, xmax: 6, site: 'https://sbacoustics.com/' },
  { id: 'ss-15w8530k00', brand: 'Scan-Speak', model: '15W/8530K00', type: 'woofer', size: '5.5"', fs: 36, re: 5.8, le: 0.38, qms: 3.0, qes: 0.37, vas: 16, sd: 87, sens: 87.0, xmax: 6.5, site: 'https://www.scan-speak.dk/' },
  { id: 'ss-18w8531g00', brand: 'Scan-Speak', model: '18W/8531G00', type: 'woofer', size: '7"', fs: 31, re: 5.8, le: 0.29, qms: 3.1, qes: 0.32, vas: 37, sd: 154, sens: 87.5, xmax: 6.5, site: 'https://www.scan-speak.dk/' },
  { id: 'seas-ca18rnx', brand: 'SEAS', model: 'Prestige CA18RNX (H1215)', type: 'woofer', size: '7"', fs: 39, re: 6.1, le: 0.6, qms: 2.4, qes: 0.40, vas: 26.4, sd: 126, sens: 87.5, xmax: 5, site: 'https://www.seas.no/' },
  { id: 'peerless-sds-p830869', brand: 'Tymphany / Peerless', model: 'SDS-P830869', type: 'woofer', size: '6.5"', fs: 45, re: 5.6, le: 0.62, qms: 2.0, qes: 0.62, vas: 18, sd: 136, sens: 87.5, xmax: 4, site: 'https://www.tymphany.com/' },
  // Midrange / full range
  { id: 'dayton-rs100-8', brand: 'Dayton Audio', model: 'RS100-8', type: 'mid', size: '4"', fs: 82, re: 7.2, le: 0.27, qms: 3.7, qes: 0.5, vas: 1.8, sd: 52, sens: 84.6, xmax: 4, site: 'https://www.daytonaudio.com/' },
  // Tweeters
  { id: 'dayton-nd25fa-4', brand: 'Dayton Audio', model: 'ND25FA-4', type: 'tweeter', size: '1"', fs: 650, re: 3.3, le: 0.03, qms: 1.8, qes: 1.0, sens: 89.0, site: 'https://www.daytonaudio.com/' },
  { id: 'dayton-dc28f-8', brand: 'Dayton Audio', model: 'DC28F-8', type: 'tweeter', size: '1.1"', fs: 720, re: 6.0, le: 0.05, qms: 1.8, qes: 0.95, sens: 89.5, site: 'https://www.daytonaudio.com/' },
  { id: 'dayton-rst28f-4', brand: 'Dayton Audio', model: 'RST28F-4', type: 'tweeter', size: '1.1"', fs: 590, re: 3.6, le: 0.03, qms: 1.6, qes: 0.8, sens: 91.0, site: 'https://www.daytonaudio.com/' },
  { id: 'sb-sb26stac-4', brand: 'SB Acoustics', model: 'SB26STAC-C000-4', type: 'tweeter', size: '1"', fs: 750, re: 3.0, le: 0.02, qms: 1.6, qes: 0.9, sens: 92.0, site: 'https://sbacoustics.com/' },
  { id: 'ss-d2608-913000', brand: 'Scan-Speak', model: 'D2608/913000', type: 'tweeter', size: '1"', fs: 500, re: 4.7, le: 0.04, qms: 1.6, qes: 1.1, sens: 90.0, site: 'https://www.scan-speak.dk/' },
  { id: 'seas-27tdfc', brand: 'SEAS', model: 'Prestige 27TDFC (H1189)', type: 'tweeter', size: '1"', fs: 650, re: 4.8, le: 0.05, qms: 1.7, qes: 1.3, sens: 90.0, site: 'https://www.seas.no/' },
  { id: 'vifa-bc25sc06-04', brand: 'Tymphany / Vifa', model: 'BC25SC06-04', type: 'tweeter', size: '1"', fs: 750, re: 3.0, le: 0.03, qms: 1.5, qes: 1.0, sens: 91.0, site: 'https://www.tymphany.com/' },
];

export const TS_KEYS = ['fs', 're', 'le', 'qms', 'qes', 'vas', 'sd', 'sens', 'xmax'];

/** Where to find FRD/ZMA data and T/S parameters. */
export const SOURCES = [
  { group: 'Manufacturers (FRD/ZMA usually on the product page)', items: [
    { name: 'Dayton Audio', url: 'https://www.daytonaudio.com/', note: 'Product pages offer a ZIP with FRD and ZMA files.' },
    { name: 'Parts Express', url: 'https://www.parts-express.com/', note: 'Dayton, Peerless, SB and others — see “Specs & downloads”.' },
    { name: 'SB Acoustics', url: 'https://sbacoustics.com/', note: 'FRD/ZMA downloads on each driver page.' },
    { name: 'SEAS', url: 'https://www.seas.no/', note: 'Datasheets plus FRD/ZMA files.' },
    { name: 'Scan-Speak', url: 'https://www.scan-speak.dk/', note: 'Datasheets; data files for many models.' },
    { name: 'Tymphany (Peerless, Vifa)', url: 'https://www.tymphany.com/', note: 'Datasheets for the Peerless/Vifa range.' },
    { name: 'Purifi', url: 'https://purifi-audio.com/', note: 'Detailed measurement data for their drivers.' },
    { name: 'Wavecor', url: 'https://www.wavecor.com/', note: 'Datasheets with FRD/ZMA.' },
  ] },
  { group: 'Independent measurements & parameters', items: [
    { name: 'HiFi Compass', url: 'https://hificompass.com/', note: 'Measured T/S parameters with FRD/ZMA downloads.' },
    { name: 'Loudspeaker Database', url: 'https://loudspeakerdatabase.com/', note: 'Searchable T/S parameters for thousands of drivers.' },
    { name: 'Zaph|Audio', url: 'https://www.zaphaudio.com/', note: 'Classic driver tests and DIY designs.' },
    { name: 'Troels Gravesen', url: 'https://www.troelsgravesen.dk/', note: 'DIY designs with crossover schematics.' },
  ] },
  { group: 'Make your own data', items: [
    { name: 'Room EQ Wizard (REW)', url: 'https://www.roomeqwizard.com/', note: 'Free measurement software — exports FRD/ZMA.' },
    { name: 'WebPlotDigitizer', url: 'https://automeris.io/', note: 'Trace graphs from a datasheet into a CSV/FRD.' },
    { name: 'VituixCAD', url: 'https://kimmosaunisto.net/', note: 'Desktop tools including a graph tracer and baffle-diffraction simulator.' },
  ] },
];

/** Search links for a driver's data files. */
export function findLinks(brand, model) {
  const q = `${brand || ''} ${model || ''}`.trim();
  const g = s => 'https://www.google.com/search?q=' + encodeURIComponent(s);
  const links = [{ name: 'Search FRD/ZMA', url: g(`${q} frd zma`) }];
  if (q) {
    links.push({ name: 'HiFi Compass', url: g(`site:hificompass.com ${q}`) });
    links.push({ name: 'Datasheet', url: g(`${q} datasheet pdf`) });
  }
  return links;
}
