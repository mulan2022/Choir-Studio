const partNames = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const lines = [
  [['G',5],['A',5],['G',5],['E',5], ['F',5],['G',5],['A',5],['G',5], ['E',5],['F',5],['G',5],['E',5], ['D',5],['C',5],['D',5],['C',5]],
  [['E',5],['F',5],['E',5],['C',5], ['D',5],['E',5],['F',5],['E',5], ['C',5],['D',5],['E',5],['C',5], ['B',4],['A',4],['B',4],['G',4]],
  [['C',4],['D',4],['C',4],['G',3], ['A',3],['C',4],['D',4],['C',4], ['G',3],['A',3],['C',4],['G',3], ['F',3],['E',3],['F',3],['E',3]],
  [['C',3],['C',3],['G',2],['C',3], ['F',2],['F',2],['C',3],['G',2], ['A',2],['A',2],['E',2],['A',2], ['G',2],['G',2],['C',3],['C',3]],
];
const words = ['和', '声', '相', '遇', '听', '见', '你', '我', '每', '个', '声', '部', '一', '起', '歌', '唱'];

function note([step, octave], index, part) {
  const notation = [];
  if (part === 0 && index === 2) notation.push('<articulations><staccato/></articulations>');
  if (part === 0 && index === 6) notation.push('<ornaments><trill-mark/></ornaments>');
  if (part === 0 && index === 12) notation.push('<glissando type="start" number="1"/>');
  if (part === 0 && index === 13) notation.push('<glissando type="stop" number="1"/>');
  const lyric = part === 0 ? `<lyric default-x="6.58" default-y="-45" name="1" number="1" relative-y="-30"><syllabic>single</syllabic><text>${words[index]}</text></lyric>` : '';
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration><type>quarter</type><stem>up</stem>${notation.length ? `<notations>${notation.join('')}</notations>` : ''}${lyric}</note>`;
}

function part(index) {
  let measures = '';
  for (let m = 0; m < 4; m++) {
    const clef = index >= 2 ? '<sign>F</sign><line>4</line>' : '<sign>G</sign><line>2</line>';
    const attrs = m === 0 ? `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef>${clef}</clef></attributes>` : '';
    const tempo = m === 0 && index === 0 ? '<direction><direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>86</per-minute></metronome></direction-type><sound tempo="86"/></direction>' : '';
    const dynamics = index === 0 && m === 0 ? '<direction><direction-type><dynamics default-x="-36" default-y="-80"><mp/></dynamics></direction-type><sound dynamics="57"/></direction>' : '';
    const swell = index === 0 && m === 1 ? '<direction><direction-type><wedge number="1" spread="0" type="crescendo"/></direction-type></direction>' : '';
    const endSwell = index === 0 && m === 2 ? '<direction><direction-type><wedge number="1" spread="15" type="stop"/></direction-type></direction><direction><direction-type><dynamics><f/></dynamics></direction-type></direction><direction><direction-type><wedge number="2" spread="15" type="diminuendo"/></direction-type></direction>' : '';
    const endDim = index === 0 && m === 3 ? '<direction><direction-type><wedge number="2" spread="0" type="stop"/></direction-type></direction><direction><direction-type><dynamics><p/></dynamics></direction-type></direction>' : '';
    measures += `<measure implicit="no" number="${m + 1}">${attrs}${tempo}${dynamics}${swell}${endSwell}${endDim}${lines[index].slice(m * 4, m * 4 + 4).map((p, j) => note(p, m * 4 + j, index)).join('')}</measure>`;
  }
  return `<part id="P${index + 1}">${measures}</part>`;
}

export const sampleXML = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE score-partwise  PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0"><work><work-title>和声练习 · 四声部示例</work-title></work><movement-title>和声练习 · 四声部示例</movement-title><identification><creator type="composer">和声间</creator></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults><part-list>${partNames.map((n,i) => `<score-part id="P${i+1}"><part-name>${n}</part-name><part-abbreviation>${n[0]}</part-abbreviation><score-instrument id="I${i+1}"><instrument-name>Voice</instrument-name></score-instrument><midi-instrument id="I${i+1}"><midi-channel>${i+1}</midi-channel><midi-program>53</midi-program></midi-instrument></score-part>`).join('')}</part-list>${partNames.map((_, i) => part(i)).join('')}</score-partwise>`;
