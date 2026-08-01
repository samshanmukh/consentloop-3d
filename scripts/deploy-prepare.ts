import { connectMedplum, deployPreparationAutomation } from '../packages/fhir/index.js';

const medplum = await connectMedplum();
const { bot, subscription } = await deployPreparationAutomation(medplum);
console.log(JSON.stringify({ bot: `Bot/${bot.id}`, subscription: `Subscription/${subscription.id}` }, null, 2));
