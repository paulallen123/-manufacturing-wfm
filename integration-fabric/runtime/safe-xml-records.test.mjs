import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSafeXml,extractXmlRecords} from './safe-xml-records.mjs';

const xml=`<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <wd:Get_Workers_Response xmlns:wd="urn:com.workday/bsvc">
      <wd:Response_Data>
        <wd:Worker><wd:Worker_ID>EMP-1</wd:Worker_ID><wd:Name>Ada &amp; Co</wd:Name></wd:Worker>
        <wd:Worker><wd:Worker_ID>EMP-2</wd:Worker_ID><wd:Name>Grace Hopper</wd:Name></wd:Worker>
      </wd:Response_Data>
    </wd:Get_Workers_Response>
  </soapenv:Body>
</soapenv:Envelope>`;

test('namespace-prefixed SOAP XML extracts reviewed record and field paths by local name',()=>{
  const records=extractXmlRecords({
    xml,
    recordPath:['Envelope','Body','Get_Workers_Response','Response_Data','Worker'],
    fields:{
      id:['Worker_ID'],
      name:['Name']
    }
  });
  assert.deepEqual(records,[
    {id:'EMP-1',name:'Ada & Co'},
    {id:'EMP-2',name:'Grace Hopper'}
  ]);
});

test('DOCTYPE and ENTITY declarations are rejected before parsing',()=>{
  for(const hostile of [
    '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
    '<?xml version="1.0"?><!ENTITY boom "x"><foo>&boom;</foo>'
  ]){
    assert.throws(()=>parseSafeXml(hostile),error=>error.code==='WFM_XML_FORBIDDEN_MARKUP');
  }
});

test('unknown named entities are rejected rather than resolved',()=>{
  assert.throws(
    ()=>parseSafeXml('<root><x>&companySecret;</x></root>'),
    error=>error.code==='WFM_XML_INVALID'
  );
});

test('numeric and predefined XML entities decode safely',()=>{
  const records=extractXmlRecords({
    xml:'<root><row><a>&lt;ok&gt;</a><b>&#65;&#x42;</b></row></root>',
    recordPath:['root','row'],
    fields:{a:['a'],b:['b']}
  });
  assert.deepEqual(records,[{a:'<ok>',b:'AB'}]);
});

test('mismatched tags multiple roots and unclosed elements fail closed',()=>{
  for(const bad of [
    '<root><x></root>',
    '<a></a><b></b>',
    '<root><x></x>'
  ]){
    assert.throws(()=>parseSafeXml(bad),error=>error.code==='WFM_XML_INVALID');
  }
});

test('record and text limits prevent XML memory amplification',()=>{
  assert.throws(
    ()=>extractXmlRecords({
      xml:'<root>'+Array.from({length:4},(_,i)=>'<row><id>'+i+'</id></row>').join('')+'</root>',
      recordPath:['root','row'],fields:{id:['id']},maxRecords:3
    }),
    error=>error.code==='WFM_XML_LIMIT'
  );
  assert.throws(
    ()=>parseSafeXml('<root><x>'+'a'.repeat(100)+'</x></root>',{maxTextChars:50}),
    error=>error.code==='WFM_XML_LIMIT'
  );
});

test('ambiguous or missing required field paths are rejected',()=>{
  assert.throws(
    ()=>extractXmlRecords({
      xml:'<root><row><id>1</id><id>2</id></row></root>',
      recordPath:['root','row'],fields:{id:['id']}
    }),
    error=>error.code==='WFM_XML_MAPPING_INVALID'
  );
  assert.throws(
    ()=>extractXmlRecords({
      xml:'<root><row></row></root>',
      recordPath:['root','row'],fields:{id:['id']}
    }),
    error=>error.code==='WFM_XML_MAPPING_INVALID'
  );
  const optional=extractXmlRecords({
    xml:'<root><row></row></root>',
    recordPath:['root','row'],fields:{id:{path:['id'],optional:true}}
  });
  assert.deepEqual(optional,[{}]);
});

test('processing instructions other than one leading XML declaration are forbidden',()=>{
  assert.throws(()=>parseSafeXml('<root><?target x?></root>'),error=>error.code==='WFM_XML_FORBIDDEN_MARKUP');
  assert.throws(()=>parseSafeXml('<?xml version="1.0"?><?xml version="1.0"?><root/>'),error=>error.code==='WFM_XML_FORBIDDEN_MARKUP');
});
