import { EcoResult, FACILITIES, Facility, Placement } from './types';
// Explicit course assumptions, not calibrated site measurements. Versioned and shown in the UI.
export const ECO_PARAMETERS = { version:'course-esv-1', years:30, discount:.035, carbonPrice:60, electricity:.488, cop:3, latentHeat:2.26e6, humidifyKwhM3:125, annualEtMm:450, so2KgHa:140.62, so2PriceT:600, dustTHa:10.9, dustPriceT:150, wallPriceM:425, wallLife:20 };
export function annuityFactor(years:number,rate:number){return rate===0?years:(1-Math.pow(1+rate,-years))/rate;}
export function calculateEco(placements:Placement[]):EcoResult {
  const p=ECO_PARAMETERS, af=annuityFactor(p.years,p.discount);
  let carbonKg=0,evaporationM3=0,so2Kg=0,dustKg=0,noiseLength=0,construction=0,maintenance=0,embodiedKg=0,area=0;
  const byFacility:Record<Facility,number>={GR:0,VS:0,RG:0,PP:0};
  for(const x of placements) {
    const f=FACILITIES[x.facility]; area+=x.area;byFacility[x.facility]+=x.area;
    const green=x.facility!=='PP'; const vegetated=green?x.area*(x.facility==='RG'?.85:.8):0;
    // Conservative teaching rates; deliberately not the paper's unresolved 13.63×2 stock formula.
    const annualSequestration=x.facility==='GR'?.35:x.facility==='VS'?.25:x.facility==='RG'?(x.trees?.8:.3):0;
    carbonKg+=x.area*(annualSequestration-f.annualEmission);
    evaporationM3+=x.area*p.annualEtMm/1000*(x.facility==='PP'?.25:green?.75:0);
    so2Kg+=vegetated/10000*p.so2KgHa;dustKg+=vegetated/10000*p.dustTHa*1000;
    // Tree belts use an explicit 5 m assumed width; no sqrt(currency) formula.
    if(x.facility==='RG' && x.trees) noiseLength+=x.area*.15/5;
    construction+=x.area*f.cost; maintenance+=x.area*f.maintenance;embodiedKg+=x.area*f.embodied;
  }
  const electricityKwh=evaporationM3*(p.latentHeat/(3600*p.cop)+p.humidifyKwhM3);
  const annual={carbon:carbonKg/1000*p.carbonPrice,cooling:electricityKwh*p.electricity,air:so2Kg/1000*p.so2PriceT+dustKg/1000*p.dustPriceT,noise:noiseLength*p.wallPriceM/annuityFactor(p.wallLife,p.discount),total:0};
  annual.total=annual.carbon+annual.cooling+annual.air+annual.noise;
  return {annual,physical:{carbonKg,evaporationM3,electricityKwh,so2Kg,dustKg,noiseLength},construction,maintenance,lifecycleCost:construction+maintenance*af,lifecycleValue:annual.total*af-embodiedKg/1000*p.carbonPrice,embodiedKg,area,byFacility};
}
