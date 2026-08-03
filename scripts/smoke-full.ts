import { connectMedplum, verifyFullWorkflow } from '../packages/fhir/index.js';

const medplum = await connectMedplum();
console.log(JSON.stringify(await verifyFullWorkflow(medplum), null, 2));
