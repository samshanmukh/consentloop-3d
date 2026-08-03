import { connectMedplum, seedDemo } from "../packages/fhir/index.js";

const medplum = await connectMedplum();
const seeded = await seedDemo(medplum);
const ids = Object.fromEntries(
  Object.entries(seeded).map(([name, resource]) => [
    name,
    `${resource.resourceType}/${resource.id}`,
  ]),
);

console.log(JSON.stringify(ids, null, 2));
