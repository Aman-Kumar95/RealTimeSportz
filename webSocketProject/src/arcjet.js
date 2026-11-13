import arcjet, { detectBot, shield, slidingWindow } from "@arcjet/node";

const arcjetKey = process.env.ARCJET_KEY;
const arcjetMode = process.env.ARCJET_MODE === "Dry Run" ? "Dry Run" : "LIVE";

if (!arcjetKey) throw new Error("ARCJET_KEY environment variable is missing.");

export const httpArcjet = arcjetKey
  ? arcjet({
      key: arcjetKey,
      rules: [
        shield({ mode: arcjetMode }),
        detectBot({
          mode: arcjetMode,
          allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:PREVIEW"],
        }),
        slidingWindow({ mode: arcjetMode, interval: "10s", max: 10 }),
      ],
    })
  : null;

export function isLocalRequest(req) {
  if (process.env.ARCJET_ENV === "development" || process.env.NODE_ENV !== "production") {
    return true;
  }

  const address = req.socket?.remoteAddress || req.connection?.remoteAddress;

  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address?.startsWith("192.168.") ||
    address?.startsWith("10.") ||
    address?.startsWith("172.")
  );
}

  export const wsArcjet= arcjetKey ?
  arcjet({
    key:arcjetKey,
    rules:[
        shield({mode:arcjetMode}),
        detectBot({mode:arcjetMode,allow:['CATEGORY:SEARCH_ENGINE','CATEGORY:PREVIEW']}),
    slidingWindow({mode:arcjetMode,interval:'2s',max:5})
    ]
  }):null

  export function securityMiddleware(){
    return async(req,res,next)=>{
      if (isLocalRequest(req)) return next();

      if(!httpArcjet) return next();

      try {
        const decison= await httpArcjet.protect(req);

        if(decison.isDenied()){
          if(decison.reason.isRateLimit()){
            return res.status(429).json({error:'Too many request.'})
          }

          return res.status(403).json({error:'Forbidden'});
        }
      } catch (e) {
        console.error('Arcjet middleware error',e);
        return res.status(503).json({error:'Service Unavailable'})
        
      }
      next();
    }
  }
