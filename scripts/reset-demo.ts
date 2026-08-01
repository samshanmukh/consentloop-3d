import { connectMedplum, resetDemo } from '../packages/fhir/index.js';

const medplum = await connectMedplum();
console.log(JSON.stringify(await resetDemo(medplum), null, 2));
