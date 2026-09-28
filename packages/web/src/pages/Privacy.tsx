import { BRAND, CONTACT_EMAIL, NOT_OFFICIAL } from "../brand";
import { useDocumentTitle } from "../theme";

export function Privacy() {
  useDocumentTitle("Privacidade, fontes e contacto");
  return (
    <div className="wrap page">
      <header className="prov-head">
        <span className="eyebrow">Sobre</span>
        <h1 className="title-1">Privacidade, fontes e contacto</h1>
        <p className="lede lede-sm">{NOT_OFFICIAL}</p>
      </header>

      <div className="prose">
        <h2 className="title-3">O que é o {BRAND}</h2>
        <p>
          Um serviço independente e gratuito que ajuda quem tem uma requisição de exames (P1) a
          encontrar prestadores com convenção ativa com o SNS. Não fazemos marcações, não somos o
          prestador e não substituímos a informação do SNS 24 nem do seu centro de saúde. Confirme
          sempre junto do prestador antes de se deslocar.
        </p>

        <h2 className="title-3">O que recolhemos sobre si</h2>
        <p>
          Nada. Não temos contas, não usamos cookies nem ferramentas de análise, e não temos
          servidores que registem as suas pesquisas. Tudo corre no seu dispositivo:
        </p>
        <ul>
          <li>
            A pesquisa e a lista de prestadores são feitas no seu navegador, a partir de um ficheiro
            de dados descarregado uma vez e guardado para funcionar sem rede.
          </li>
          <li>
            Se usar “perto de mim”, a localização é lida pelo navegador e usada só para ordenar por
            distância. Nunca é enviada para nós.
          </li>
          <li>
            O navegador guarda localmente a sua preferência de aparência e as últimas pesquisas,
            para as sugerir. Pode apagá-las limpando os dados do site.
          </li>
        </ul>

        <h2 className="title-3">Serviços de terceiros que o seu navegador contacta</h2>
        <ul>
          <li>
            <b>OpenFreeMap</b> (tiles.openfreemap.org): fornece o mapa. Recebe os pedidos das
            imagens da zona que está a ver.
          </li>
          <li>
            <b>GEO API PT</b> (json.geoapi.pt): só quando escreve um código postal que não
            conseguimos localizar com os dados que já temos. Recebe o código postal, nada mais.
          </li>
          <li>
            <b>Google Maps</b>: só se carregar em “Abrir no Google Maps”. A partir daí aplicam-se as
            condições da Google.
          </li>
        </ul>
        <p>
          Nenhum destes serviços recebe o nome do exame que pesquisou nem a sua localização, com
          exceção do mapa, que precisa de saber que zona mostrar.
        </p>

        <h2 className="title-3">De onde vêm os dados</h2>
        <ul>
          <li>
            <b>ACSS / SPMS</b>: a lista nacional de entidades convencionadas, publicada na página
            “Rede de Prestadores Convencionados” da ACSS. É a fonte das moradas, contactos e exames
            de cada convenção. Atualizamos uma vez por mês.
          </li>
          <li>
            <b>Portal da Transparência do SNS</b>: número de exames convencionados pedidos a cada
            entidade, por área e por mês. É a base do sinal “Aceita o SNS” e de “Muito procurado”.
          </li>
          <li>
            <b>Entidade Reguladora da Saúde (ERS)</b>: tabela semestral “Reclamações em números”,
            com reclamações e elogios por entidade.
          </li>
          <li>
            <b>ACSS</b>: tabela de preços dos MCDT do setor convencionado, para reconhecer códigos
            de exame.
          </li>
        </ul>
        <p>
          Os dados são reutilizados ao abrigo da Lei n.º 26/2016 (acesso e reutilização de
          informação administrativa). Os números que mostramos são derivados dessas fontes e podem
          conter erros de cruzamento. Em caso de dúvida, vale a fonte original.
        </p>

        <h2 className="title-3">Dados dos prestadores</h2>
        <p>
          Mostramos os dados que a ACSS publica sobre cada convenção: nome, morada, telefone, email
          e exames. Quando o titular da convenção é uma pessoa singular, não publicamos o seu NIF.
          Se representa um prestador e quer corrigir ou retirar informação, escreva-nos.
        </p>

        <h2 className="title-3">Contacto</h2>
        <p>{CONTACT_EMAIL}</p>
      </div>
    </div>
  );
}
