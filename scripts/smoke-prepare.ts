import { connectMedplum, runPreparationSmoke } from '../packages/fhir/index.js';

const medplum = await connectMedplum();
const resources = await runPreparationSmoke(medplum);
console.log(
  JSON.stringify(
    Object.fromEntries(Object.entries(resources).map(([name, resource]) => [name, `${resource.resourceType}/${resource.id}`])),
    null,
    2,
  ),
);
