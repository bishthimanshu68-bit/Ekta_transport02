"""Ekta Lightning V3 - local-only OCR tester. No database writes."""
import hashlib
import os
# Optional CPU tuning. Defaults preserve original OCR behaviour.
THREADS = int(os.environ.get("EKTA_OCR_THREADS", "0"))
if THREADS not in (0, 1, 2, 4):
    raise ValueError("EKTA_OCR_THREADS must be 0, 1, 2 or 4")
if THREADS:
    os.environ["OMP_NUM_THREADS"] = str(THREADS)
    os.environ["OPENBLAS_NUM_THREADS"] = str(THREADS)
    os.environ["MKL_NUM_THREADS"] = str(THREADS)
import io
import re
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageOps
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse

app = FastAPI(title='Ekta Lightning V3 — Isolated Speed Test')
_ocr = None
_fast_ocr = None
_cache = {}
FIELDS = ['LR Number','Vehicle Number','LR Date','From','To','Quantity','Vehicle Size','Consignor','Consignee','Invoice Number','Reporting Date','Unloading Date','POD Received Date','Remarks']
VEHICLE_RE = re.compile(r'\b([A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{4})\b')
LR_RE = re.compile(r'(?<!\d)\d{4}[/-]\d{1,2}[/-]\d{4,10}(?!\d)')
DATE_RE = re.compile(r'\b(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b')

@app.get('/', response_class=HTMLResponse)
def home():
    return Path(__file__).with_name('index.html').read_text(encoding='utf-8')

def engine():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(lang='en', device='cpu', enable_mkldnn=False,
                         use_doc_orientation_classify=False, use_doc_unwarping=False,
                         use_textline_orientation=False)
    return _ocr

def lightning_engine():
    """Lightweight ONNX CPU OCR; optional installation, independent of PaddleOCR."""
    global _fast_ocr
    if _fast_ocr is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError:
            raise HTTPException(503, 'Lightning OCR not installed. Run install_lightning.bat, then restart start_ai.bat.')
        _fast_ocr = RapidOCR()
    return _fast_ocr

def date_value(s):
    m = DATE_RE.search(s)
    if not m:
        return None
    v = m.group().replace('.', '-').replace('/', '-')
    a = v.split('-')
    if len(a[0]) == 4:
        yyyy, mm, dd = a
    else:
        dd, mm, yyyy = a
        if len(yyyy) == 2:
            yyyy = '20' + yyyy
    try:
        from datetime import date
        return date(int(yyyy), int(mm), int(dd)).isoformat()
    except ValueError:
        return None

def clean_vehicle(v):
    return re.sub(r'\s+', '', v.upper())

def extract(pages):
    """Label-aware extraction that tolerates missing spaces from Lightning OCR."""
    pool = defaultdict(list)
    records = []
    def add(field, value, page, score, source, weight=5):
        value = str(value).strip(' :;,.')
        if value and len(value) < 140:
            pool[field].append(dict(value=value, page=page, score=score, source=source, weight=weight))

    for p in pages:
        lines = p['lines']
        page = p['page']
        record = {'page':page, 'lr_number':'', 'vehicle_number':'', 'lr_date':'', 'quantity':'', 'invoice_number':''}
        for i, line in enumerate(lines):
            original = line['text'].strip()
            # Normalize labels only; never rewrite the actual registration/LR digits.
            text = re.sub(r'(?i)\b(LR)\s*(NO\.?|DATE)\s*', lambda m: m.group(1)+' '+m.group(2)+' ', original)
            text = re.sub(r'(?i)(VEHICLE|TRUCK|LORRY)\s*(NO\.?|NUMBER|TYPE|SIZE)', r'\1 \2', text)
            text = re.sub(r'(?i)(TOTAL)\s*(QUANTITY|QTY)', r'\1 \2', text)
            text = re.sub(r'(?i)(INVOICE)\s*(NO\.?|NUMBER)', r'\1 \2', text)
            text = re.sub(r'(?i)(FROM|TO)\s*:', r' \1:', text)
            upper = text.upper()
            nxt = lines[i+1]['text'].strip() if i+1 < len(lines) else ''
            score = line['score']
            lr_match = LR_RE.search(upper)
            if lr_match and (re.search(r'LR\s*NO', upper[:lr_match.start()]) or (i and re.search(r'LR\s*NO\.?\s*:?$', lines[i-1]['text'], re.I))):
                val=lr_match.group()
                add('LR Number',val,page,score,original,6)
                record['lr_number'] = val
            # Registration can be immediately followed by VehicleType without a space.
            veh = re.search(r'(?i)(?:VEHICLE|TRUCK|LORRY)\s*(?:NO\.?|NUMBER)\s*:?\s*([A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{4})',upper)
            if not veh and re.search(r'(?i)(?:VEHICLE|TRUCK|LORRY)\s*(?:NO\.?|NUMBER)\s*:?$',upper):
                veh = VEHICLE_RE.search(nxt.upper())
            if veh:
                val=clean_vehicle(veh.group(1) if veh.lastindex else veh.group())
                add('Vehicle Number',val,page,score,original,6)
                record['vehicle_number']=val
            date_label = re.search(r'(?i)LR\s*DATE\s*:?\s*',text)
            if date_label:
                d=date_value(text[date_label.end():]) or (date_value(nxt) if len(nxt)<28 else None)
                if d:
                    add('LR Date',d,page,score,original,6)
                    record['lr_date']=d
            for field,pattern in [('From',r'(?i)\bFROM\s*:\s*(.+)'),('To',r'(?i)\bTO\s*:\s*(.+)')]:
                m=re.search(pattern,text)
                if m:
                    val=re.split(r'(?i)\b(?:FROM|TO|LR\s*(?:NO|DATE)|CONSIGNEE|CONSIGNOR)\s*:',m.group(1))[0]
                    val=re.split(r'(?i)(?:CONSIGNEE\s*COPY|TRANSPORTER\s*COPY)$',val)[0].strip()
                    if val: add(field,val.title(),page,score,original,5)
            size=re.search(r'(?i)VEHICLE\s*(?:TYPE|SIZE)\s*:?\s*(\d{2}\s*FT[A-Z0-9-]*)',upper)
            if size: add('Vehicle Size',size.group(1).replace(' ',''),page,score,original,6)
            for field in ('Consignor','Consignee'):
                m=re.search(r'(?i)\b'+field+r'\s*[:.]\s*(.+)',text)
                if m: add(field,m.group(1),page,score,original,5)
            for field,label in [('Reporting Date','REPORTING DATE'),('Unloading Date','UNLOADING DATE'),('POD Received Date','POD RECEIVED DATE')]:
                if label in upper:
                    d=date_value(text)
                    if d: add(field,d,page,score,original,5)
            # Quantity only from explicit Total Quantity or item table; never Total CFT.
            if re.search(r'(?i)TOTAL\s*(?:QUANTITY|QTY)',upper):
                m=re.search(r'(?i)TOTAL\s*(?:QUANTITY|QTY)\s*:?\s*(\d{1,6})(?!\d)',upper)
                if m: q=m.group(1)
                elif re.fullmatch(r'\d{1,6}',nxt): q=nxt
                else: q=None
                if q:
                    add('Quantity',q,page,score,original,6)
                    record['quantity']=q
            # Invoice labels are often followed by Dated/Amount column headers;
            # find the numeric invoice value later in the same block.
            if re.search(r'(?i)INVOICE\s*(?:NO\.?|NUMBER)',upper):
                m=re.search(r'(?i)INVOICE\s*(?:NO\.?|NUMBER)\s*:?\s*(\d{6,16})\b',upper)
                val=m.group(1) if m else None
                if not val:
                    for later in lines[i+1:i+13]:
                        candidate=later['text'].strip()
                        if re.fullmatch(r'\d{8,14}',candidate):
                            val=candidate;break
                if val:
                    add('Invoice Number',val,page,score,original,5)
                    record['invoice_number']=val
        # Spatially grounded quantity: prefer the value beside/below Total Quantity,
        # not CFT, weight, freight or a free-floating digit.
        if not record['quantity']:
            for idx, row in enumerate(lines):
                label = re.sub(r'[^A-Z]', '', row['text'].upper())
                if 'TOTALQUANTITY' not in label and 'TOTALQTY' not in label:
                    continue
                m = re.search(r'(?i)TOTAL\s*(?:QUANTITY|QTY)\s*:?\s*(\d{1,6})\b', row['text'])
                if m:
                    record['quantity'] = m.group(1)
                    break
                # Search a limited region of OCR reading order, with optional boxes.
                near = lines[idx+1:idx+9]
                basebox = row.get('box')
                valid=[]
                for offset, candidate in enumerate(near):
                    v = candidate['text'].strip()
                    if not re.fullmatch(r'\d{1,5}',v): continue
                    cb = candidate.get('box')
                    distance=offset
                    if basebox and cb:
                        # favor close by values and avoid distant table columns
                        dx=max(0, cb[0]-basebox[2],basebox[0]-cb[2])
                        dy=max(0, cb[1]-basebox[3],basebox[1]-cb[3])
                        distance=dx/120+dy/35
                    valid.append((distance,offset,v))
                if valid:
                    valid.sort()
                    record['quantity']=valid[0][2]
                    break
        # Item table fallback when Total Quantity OCR is fragmented: look for Qty
        # and the nearest small integer after a product label, excluding CFT/weight.
        if not record['quantity']:
            for idx, row in enumerate(lines):
                if re.fullmatch(r'(?i)\s*QTY\s*',row['text']):
                    block=lines[idx+1:idx+12]
                    numbers=[(j,r['text'].strip()) for j,r in enumerate(block) if re.fullmatch(r'\d{1,4}',r['text'].strip())]
                    if numbers:
                        record['quantity']=numbers[0][1]
                        break
        if record['quantity']:
            add('Quantity',record['quantity'],page,0.95,'Quantity linked to page',5)
        # Do not silently overwrite contradictory vehicle readings.
        records.append(record)
    # A page can be a supporting POD/invoice rather than a new LR.
    # Never create additional LR identifiers from the filename or a stamp.
    known=[r['vehicle_number'] for r in records if r['vehicle_number']]
    from collections import Counter
    counts=Counter(known)
    for r in records:
        v=r['vehicle_number']
        if v and counts[v]==1 and len(known)>=3:
            alternative=counts.most_common(1)[0]
            if alternative[1]>=2 and alternative[0]!=v:
                r['vehicle_warning']='Different vehicle OCR across pages; verify original (most common: '+alternative[0]+')'
    result={}
    for field,entries in pool.items():
        grouped={}
        for e in entries:
            k=e['value'].upper()
            if k not in grouped:
                grouped[k]=dict(e,pages=[e['page']],occurrences=1)
            else:
                g=grouped[k];g['occurrences']+=1
                if e['page'] not in g['pages']:g['pages'].append(e['page'])
                if (e['weight'],e['score'])>(g['weight'],g['score']):g.update({z:e[z] for z in ('weight','score','source')})
        result[field]=sorted(grouped.values(),key=lambda v:(v['weight']+2*min(3,len(v['pages'])),v['score'],v['occurrences']),reverse=True)[:12]
    return result,records

def digital_pdf_lines(page):
    """Use real embedded text only when it has sufficient labelled LR fields.

    Scanned/image PDFs always fall back to the original PaddleOCR path.
    """
    text = page.get_text('text', sort=True)
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    joined = ' '.join(lines).upper()
    has_lr = bool(re.search(r'\bLR\s*(?:NO|NUMBER|DATE)\b', joined))
    has_vehicle = bool(re.search(r'\bVEHICLE\s*(?:NO|NUMBER|TYPE)\b', joined))
    if len(joined) < 180 or len(lines) < 12 or not (has_lr and has_vehicle):
        return None
    # Some PDFs have label and value in adjacent text blocks; preserve each line.
    return [{'text': line, 'score': 1.0} for line in lines]

@app.post('/read')
async def read(file: UploadFile = File(...), resolution: float = Form(1.25), ocr_engine: str = Form('lightning')):
    if ocr_engine not in ('lightning', 'paddle'):
        raise HTTPException(400, 'Invalid OCR engine')
    if resolution not in (0.75, 0.85, 1.0, 1.25, 1.6):
        raise HTTPException(400, 'Invalid resolution')
    data = await file.read()
    if not data or len(data) > 25_000_000:
        raise HTTPException(413, 'File must be 1 byte to 25 MB')
    key = hashlib.sha256(data + f'{resolution}:{ocr_engine}'.encode()).hexdigest()
    if key in _cache:
        return dict(_cache[key], cached=True)
    start = time.perf_counter()
    timing = []
    try:
        pages = []
        if data.startswith(b'%PDF'):
            doc = pymupdf.open(stream=data, filetype='pdf')
            if len(doc) > 12:
                raise HTTPException(400, 'Maximum 12 pages')
            total = len(doc)
            def render(n):
                pix = doc[n].get_pixmap(matrix=pymupdf.Matrix(resolution,resolution), alpha=False)
                return Image.frombytes('RGB', (pix.width,pix.height), pix.samples)
        else:
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert('RGB')
            total = 1
            def render(n):
                return image.copy()
        for i in range(total):
            t0 = time.perf_counter()
            direct = digital_pdf_lines(doc[i]) if data.startswith(b'%PDF') else None
            if direct is not None:
                direct_seconds = round(time.perf_counter()-t0,3)
                timing.append({'page':i+1,'digital_text_seconds':direct_seconds})
                pages.append({'page':i+1, 'lines':direct, 'seconds':round(direct_seconds,2), 'method':'Digital PDF text'})
                continue
            render_start = time.perf_counter()
            image = render(i)
            # Prevent huge input dimensions on an older CPU.
            image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
            render_seconds = round(time.perf_counter() - render_start, 3)
            t0 = time.perf_counter()
            lines = []
            if ocr_engine == 'lightning':
                response, _ = lightning_engine()(np.asarray(image))
                for item in response or []:
                    if len(item) >= 3:
                        lines.append({'text':str(item[1]), 'score':round(float(item[2]),3), 'box':[round(float(min(pt[0] for pt in item[0])),1),round(float(min(pt[1] for pt in item[0])),1),round(float(max(pt[0] for pt in item[0])),1),round(float(max(pt[1] for pt in item[0])),1)]})
                method = 'Lightning ONNX (scanned)'
            else:
                response = engine().predict(np.asarray(image))
                for obj in response:
                    for text, score in zip(obj.get('rec_texts',[]), obj.get('rec_scores',[])):
                        lines.append({'text':str(text), 'score':round(float(score),3)})
                method = 'PaddleOCR (scanned)'
            ocr_seconds = round(time.perf_counter()-t0, 3)
            timing.append({'page':i+1, 'render_seconds':render_seconds, 'ocr_seconds':ocr_seconds})
            pages.append({'page':i+1,'lines':lines,'seconds':round(ocr_seconds,1),'method':method})
        candidates, records = extract(pages)
        result = {'pages':pages,'candidates':candidates,'records':records,'filename':file.filename,
                  'seconds':round(time.perf_counter()-start,1),'timing':timing,'cpu_threads_setting':THREADS,'cached':False,'profile':'Haier/LG + generic labels (experimental)'}
        if len(_cache) >= 5:
            _cache.pop(next(iter(_cache)))
        _cache[key] = result
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f'OCR failed: {exc}')

