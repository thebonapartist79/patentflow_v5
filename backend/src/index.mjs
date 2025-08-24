import express from 'express';
const app = express();
app.use(express.json());
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.listen(8080,()=>console.log('Backend on 8080'));
