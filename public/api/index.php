<?php
declare(strict_types=1);
/**
 * EXPERIMENTAL read-only Apple Notes bridge for PHP 8.2+.
 * Apple's private protocol is unsupported and may change.
 * Requirements: ext-curl, sessions, HTTPS, Apache mod_rewrite.
 * Set NOTES_ACCESS_KEY in the PHP hosting environment (minimum 24 characters).
 * Do not publish credential details or Apple session tokens.
 */
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['SERVER_PORT'] ?? '') === '443');
if (!$https && !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1','::1'],true)) {
    http_response_code(403); echo json_encode(['error'=>'HTTPS vereist']); exit;
}
ini_set('session.use_strict_mode','1');
ini_set('session.use_only_cookies','1');
session_name('ICLOUD_NOTES_SID');
session_set_cookie_params(['lifetime'=>0,'path'=>'/wallet/','secure'=>$https,'httponly'=>true,'samesite'=>'Strict']);
session_start();
function respond(array $data,int $code=200):never {
    http_response_code($code);echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);exit;
}
function fail(string $message,int $code=400):never {respond(['error'=>$message],$code);}
function body():array {
    $raw=file_get_contents('php://input');
    $d=json_decode($raw?:'{}',true);
    if (!is_array($d)) fail('JSON verwacht');
    return $d;
}
$uri=parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path=preg_replace('~^.*?/api(?:/index\.php)?~','',$uri) ?: '/';
$method=$_SERVER['REQUEST_METHOD'] ?? 'GET';
$origin='https://'.($_SERVER['HTTP_HOST'] ?? '');
if($method!=='GET'){
    if(!hash_equals($origin,$_SERVER['HTTP_ORIGIN'] ?? '')) fail('Ongeldige verzoekherkomst',403);
    if(stripos($_SERVER['CONTENT_TYPE'] ?? '','application/json')!==0) fail('JSON vereist',415);
}
if($method==='GET' && $path==='/health'){
    respond(['php'=>true,'version'=>PHP_VERSION,'curl'=>extension_loaded('curl'),'configured'=>strlen(getenv('NOTES_ACCESS_KEY')?:'')>=24]);
}
$secret=getenv('NOTES_ACCESS_KEY')?:'';
if(strlen($secret)<24) fail('Server niet geconfigureerd: NOTES_ACCESS_KEY ontbreekt',503);
if($method==='POST' && $path==='/unlock'){
    $now=time();$attempts=array_filter($_SESSION['attempts']??[],fn($x)=>$now-$x<300);
    $attempts[]=$now;$_SESSION['attempts']=$attempts;
    if(count($attempts)>8) fail('Te veel pogingen',429);
    $supplied=body()['access_key']??'';
    if(!is_string($supplied)||!hash_equals($secret,$supplied)) fail('Onjuiste toegangscode',401);
    session_regenerate_id(true);$_SESSION['owner']=true;
    respond(['ok'=>true]);
}
if(empty($_SESSION['owner'])) fail('Ontgrendel de app eerst',401);
function apple(string $url,string $method='GET',?array $data=null,array $headers=[]):array{
    if(!preg_match('~^https://(?:[a-z0-9-]+\.)*(?:apple\.com|icloud\.com)(?:/|$)~i',$url)){
       fail('Geblokkeerde externe host',502);
    }
    if(!extension_loaded('curl')) fail('PHP cURL ontbreekt op de hosting',503);
    $cookie=$_SESSION['cookie_path']??null;
    if(!$cookie || !is_file($cookie)){
        $cookie=tempnam(sys_get_temp_dir(),'icloudnotes_');
        if(!$cookie) fail('Server kan geen sessiecookies opslaan',503);
        chmod($cookie,0600);$_SESSION['cookie_path']=$cookie;
    }
    $ch=curl_init($url);
    $hdr=['Accept: application/json','Origin: https://www.icloud.com','Referer: https://www.icloud.com/','User-Agent: Mozilla/5.0 iCloudNotesPHP/0.1'];
    foreach($headers as $h)$hdr[]=$h;
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_HEADER=>true,
       CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$hdr,
       CURLOPT_COOKIEFILE=>$cookie,CURLOPT_COOKIEJAR=>$cookie,
       CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,
       CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>25]);
    if($data!==null){
       curl_setopt($ch,CURLOPT_POSTFIELDS,json_encode($data,JSON_UNESCAPED_SLASHES));
       $hdr[]='Content-Type: application/json';
       curl_setopt($ch,CURLOPT_HTTPHEADER,$hdr);
    }
    $raw=curl_exec($ch);
    $status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);
    $headerSize=(int)curl_getinfo($ch,CURLINFO_HEADER_SIZE);
    $error=curl_error($ch);curl_close($ch);
    if($raw===false) fail('Apple niet bereikbaar: '.$error,502);
    $head=substr($raw,0,$headerSize);
    $payload=substr($raw,$headerSize);
    $captured=[];
    foreach(['X-Apple-ID-Account-Country'=>'account_country','X-Apple-ID-Session-Id'=>'session_id',
       'X-Apple-Session-Token'=>'session_token','X-Apple-TwoSV-Trust-Token'=>'trust_token','scnt'=>'scnt'] as $h=>$k){
       if(preg_match('~^'.preg_quote($h,'~').':\s*(.+)$~mi',$head,$m)){
          $_SESSION['apple_'.$k]=trim($m[1]);$captured[$k]=true;
       }
    }
    $json=json_decode($payload,true);
    return ['code'=>$status,'json'=>is_array($json)?$json:[], 'headers'=>$captured];
}
function auth_headers():array{
  $h=['X-Apple-Widget-Key: d39ba9916a68a0f3f', 'X-Apple-I-FD-Client-Info: {"U":"Mozilla/5.0","L":"nl-NL","Z":"GMT+01:00","V":"1.1","F":""}'];
  if(!empty($_SESSION['apple_scnt']))$h[]='scnt: '.$_SESSION['apple_scnt'];
  if(!empty($_SESSION['apple_session_id']))$h[]='X-Apple-ID-Session-Id: '.$_SESSION['apple_session_id'];
  return $h;
}
function account_login():array{
  $r=apple('https://setup.icloud.com/setup/ws/1/accountLogin','POST',[
    'accountCountryCode'=>$_SESSION['apple_account_country']??'NL',
    'dsWebAuthToken'=>$_SESSION['apple_session_token']??'',
    'extended_login'=>true,'trustToken'=>$_SESSION['apple_trust_token']??''
  ]);
  if($r['code']>=400 || empty($r['json']['webservices']))fail('Apple heeft de iCloud-sessie niet geactiveerd',401);
  $_SESSION['apple_services']=$r['json']['webservices'];
  return $r['json'];
}
if($method==='GET' && $path==='/status'){
   respond(['configured'=>true,'authenticated'=>!empty($_SESSION['apple_services']['notes']['url'])]);
}
if($method==='POST' && $path==='/login'){
   $d=body();$username=$d['username']??'';$password=$d['password']??'';
   if(!is_string($username)||!filter_var($username,FILTER_VALIDATE_EMAIL)||!is_string($password)||strlen($password)<1)fail('Apple-account en wachtwoord vereist');
   // Apple's older JSON sign-in endpoint, provided as experimental compatibility path.
   // Current Apple accounts may require SRP-6a, which is not implemented in this PHP port.
   $r=apple('https://idmsa.apple.com/appleauth/auth/signin?isRememberMeEnabled=true','POST',
       ['accountName'=>$username,'password'=>$password,'rememberMe'=>true,'trustTokens'=>[]],auth_headers());
   unset($password,$d);
   if(in_array($r['code'],[409,412],true))respond(['requires_2fa'=>true]);
   if($r['code']>=400)fail('Apple heeft deze aanmeldmethode geweigerd. Nieuwere SRP-aanmelding wordt nog niet ondersteund.',422);
   if(empty($_SESSION['apple_session_token']))fail('Apple gaf geen sessietoken terug; de inlogmethode wordt niet ondersteund',422);
   account_login();
   respond(['authenticated'=>true]);
}
if($method==='POST' && $path==='/verify'){
   $code=body()['code']??'';
   if(!is_string($code)||!preg_match('/^[0-9]{6}$/',$code))fail('Zescijferige code vereist');
   $r=apple('https://idmsa.apple.com/appleauth/auth/verify/trusteddevice/securitycode','POST',
       ['securityCode'=>['code'=>$code]],auth_headers());
   if($r['code']>=400)fail('Apple heeft de verificatiecode afgewezen',401);
   $trust=apple('https://idmsa.apple.com/appleauth/auth/2sv/trust','GET',null,auth_headers());
   if($trust['code']>=400)fail('Apple kon dit apparaat niet vertrouwen',401);
   account_login();respond(['authenticated'=>true]);
}
if($method==='POST' && $path==='/logout'){
   if(!empty($_SESSION['cookie_path']))@unlink($_SESSION['cookie_path']);
   $_SESSION=[];session_destroy();respond(['ok'=>true]);
}
if(empty($_SESSION['apple_services']['notes']['url']))fail('Niet verbonden met Apple',401);
$base=rtrim($_SESSION['apple_services']['notes']['url'],'/').'/database/1/com.apple.notes/production/private';
if($method==='GET' && $path==='/folders') respond(['folders'=>[],'warning'=>'De CloudKit-gegevensdecoder is nog niet volledig geïmplementeerd.']);
if($method==='GET' && $path==='/notes') {
   fail('De CloudKit Notes recordparser is nog niet geïmplementeerd; er worden geen onvolledige notities getoond.',501);
}
if($method==='GET' && str_starts_with($path,'/notes/')) fail('Notitie-decodering is nog niet beschikbaar',501);
fail('Onbekend endpoint',404);
