import { NextRequest, NextResponse } from "next/server";

const BASE = "https://www.trendtrader.cn/apiData/data";
const allowedFields = new Set(["return1m","return3m","returnYTD","trendTemperatureCurr","trendPhaseCurr","trendStrengthGlobalCurr","daysSinceTrendEntry"]);

async function call(name:string, params:Record<string,string>={}){
  const apiKey=process.env.TRENDTRADER_API_KEY;
  if(!apiKey) throw new Error("服务端尚未配置趋势动物 API Key");
  const url=new URL(`${BASE}/${name}`); url.searchParams.set("apiKey",apiKey);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const res=await fetch(url,{cache:"no-store"});
  const json=await res.json();
  if(!res.ok||json.code!=="00000"||json.success===false) throw new Error(json.msg||`${name} 调用失败`);
  return json;
}

export async function POST(req:NextRequest){
  try{
    const body=await req.json();
    if(body.action==="search"){
      const keyword=String(body.keyword||"").trim().slice(0,40); if(!keyword) throw new Error("请输入搜索关键词");
      const result=await call("searchTicker",{keyword}); return NextResponse.json({data:result.data});
    }
    if(body.action==="inspect"){
      const tmIds=Array.isArray(body.tmIds)?body.tmIds.map(Number).filter(Number.isFinite).slice(0,20):[]; if(!tmIds.length) throw new Error("请选择至少一个品种");
      const requested=Array.isArray(body.fields)?body.fields.filter((x:unknown)=>typeof x==="string"&&allowedFields.has(x)):[];
      const [status,billing]=await Promise.all([call("getUpdateStatus"),call("getSnapshotColumnBilling")]);
      const billMap=new Map((billing.data||[]).map((x:{columnName:string;priceCost:number})=>[x.columnName,Number(x.priceCost)||0]));
      const estimatedCost=requested.reduce((sum:number,k:string)=>sum+(billMap.get(k)||0),0)*tmIds.length;
      if(estimatedCost>=1) throw new Error(`本轮预估费用 ¥${estimatedCost.toFixed(3)}，达到 1 元，已按规范停止，请缩小范围`);
      const snapshot=await call("getTickerSnapshot",{tmIds:tmIds.join(","),fields:requested.join(",")});
      const targetAssets=new Set((snapshot.data||[]).map((x:{asset?:string})=>x.asset).filter(Boolean));
      const matched=(status.data||[]).filter((x:{asset?:string})=>targetAssets.has(x.asset));
      const latest=matched.sort((a:{updateDt?:string},b:{updateDt?:string})=>String(b.updateDt||"").localeCompare(String(a.updateDt||"")))[0]||null;
      return NextResponse.json({data:snapshot.data,status:latest,estimatedCost,fields:requested});
    }
    return NextResponse.json({error:"不支持的操作"},{status:400});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"服务异常"},{status:500});}
}
