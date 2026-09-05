// Sender roles come from the saved relationship configuration, never model output.
function premiumPeople(relationshipId,configuration){
 const name=v=>String(v||'').trim().slice(0,80);
 const viewerPerson=Object.freeze({id:relationshipId+':self',sender:'self',name:name(configuration.selfName)||'あなた'});
 const partnerPerson=Object.freeze({id:relationshipId+':partner',sender:'partner',name:name(configuration.partnerName)||'パートナー'});
 return Object.freeze({viewerPerson,partnerPerson,feelingsFocalPerson:partnerPerson});
}
module.exports={premiumPeople};
